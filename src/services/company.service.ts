import { env } from '../config/env.js';
import { Company } from '../models/Company.js';
import { CompanyQrCode } from '../models/CompanyQrCode.js';
import { QrScan } from '../models/QrScan.js';
import { Review } from '../models/Review.js';
import { HttpError } from '../utils/httpError.js';
import { createSlug } from '../utils/slug.js';
import { getCompanyFeedbackFormConfig } from './feedbackForm.service.js';
import { generateQrDataUrl } from './qr.service.js';
import { buildQrPdfBuffer } from './pdf.service.js';
import { sendTemplateMail } from './notificationTemplate.service.js';

type RegisterCompanyInput = {
  name: string;
  email: string;
};

type RecordPublicScanInput = {
  idempotencyKey?: string;
  userAgent?: string;
  source?: string;
};

type ReminderScheduleItem = {
  dueAt: Date;
  kind: string;
};

export function buildReminderSchedule(limitReachedAt: Date): ReminderScheduleItem[] {
  const start = new Date(limitReachedAt);
  const schedule = [
    { kind: 'after_6_hours', dueAt: new Date(start.getTime() + 6 * 60 * 60 * 1000) },
    { kind: 'after_3_days', dueAt: new Date(start.getTime() + 3 * 24 * 60 * 60 * 1000) },
    { kind: 'after_18_days', dueAt: new Date(start.getTime() + 18 * 24 * 60 * 60 * 1000) }
  ];

  const firstMonthly = new Date(start);
  firstMonthly.setMonth(firstMonthly.getMonth() + 1);
  firstMonthly.setDate(5);
  firstMonthly.setHours(9, 0, 0, 0);

  for (let index = 0; index < 3; index += 1) {
    const dueAt = new Date(firstMonthly);
    dueAt.setMonth(firstMonthly.getMonth() + index);
    schedule.push({ kind: `monthly_${index + 1}`, dueAt });
  }

  return schedule;
}

export async function registerCompany({ name, email }: RegisterCompanyInput) {
  const slug = createSlug(name);
  const feedbackUrl = `${env.frontendUrl}/avis/${slug}`;
  const qrCodeDataUrl = await generateQrDataUrl(feedbackUrl);

  const company = await Company.create({
    name,
    email,
    slug,
    feedbackUrl,
    qrCodeDataUrl,
    freeEmailNotificationsLimit: env.freeEmailNotifications,
    unlimitedAccess: true,
    unlimitedAccessActivatedAt: new Date()
  });

  const pdf = await buildQrPdfBuffer({ companyName: name, feedbackUrl, qrCodeDataUrl });
  await sendTemplateMail({
    name: 'company-qr-code-ready',
    to: email,
    variables: { companyName: name, feedbackUrl },
    subject: 'Votre QR Code de collecte d’avis',
    html: `
      <p>Bonjour ${name},</p>
      <p>Votre lien de collecte est prêt : <a href="${feedbackUrl}">${feedbackUrl}</a>.</p>
      <p>Vous recevrez les nouveaux avis par email. Connectez-vous ensuite a votre espace QrFeedback pour activer les notifications Telegram.</p>
    `,
    attachments: [{ filename: `qr-code-${slug}.pdf`, content: pdf, contentType: 'application/pdf' }]
  });

  return company;
}

export async function getPublicCompany(slug: string) {
  const company = await Company.findOne({ slug }).select('name slug feedbackUrl feedbackFormConfig');
  if (company) {
    return {
      name: company.name,
      slug: company.slug,
      feedbackUrl: company.feedbackUrl,
      feedbackFormConfig: getCompanyFeedbackFormConfig(company)
    };
  }

  const qrCode = await CompanyQrCode.findOne({ slug, isActive: { $ne: false } });
  if (!qrCode) throw new HttpError(404, 'Entreprise introuvable.');

  const qrCompany = await Company.findById(qrCode.company).select('name feedbackFormConfig');
  if (!qrCompany) throw new HttpError(404, 'Entreprise introuvable.');

  return {
    name: qrCompany.name,
    slug: qrCode.slug,
    feedbackUrl: qrCode.feedbackUrl,
    feedbackFormConfig: getCompanyFeedbackFormConfig(qrCompany)
  };
}

export async function recordPublicScan(slug: string, input: RecordPublicScanInput = {}) {
  const company = await Company.findOne({ slug }).select('_id slug');
  if (company) {
    await createScanEvent({
      companyId: company._id,
      slug: company.slug,
      idempotencyKey: input.idempotencyKey,
      userAgent: input.userAgent,
      source: input.source
    });
    return { ok: true };
  }

  const qrCode = await CompanyQrCode.findOne({ slug, isActive: { $ne: false } }).select('_id company slug');
  if (!qrCode) throw new HttpError(404, 'QR code introuvable.');

  const created = await createScanEvent({
    companyId: qrCode.company,
    qrCodeId: qrCode._id,
    slug: qrCode.slug,
    idempotencyKey: input.idempotencyKey,
    userAgent: input.userAgent,
    source: input.source
  });

  if (created) {
    await CompanyQrCode.updateOne(
      { _id: qrCode._id },
      { $inc: { scanCount: 1 }, $set: { lastScannedAt: new Date() } }
    );
  }

  return { ok: true };
}

async function createScanEvent(input: {
  companyId: unknown;
  qrCodeId?: unknown;
  slug: string;
  idempotencyKey?: string;
  userAgent?: string;
  source?: string;
}) {
  try {
    await QrScan.create({
      company: input.companyId,
      qrCode: input.qrCodeId,
      slug: input.slug,
      idempotencyKey: input.idempotencyKey?.trim().slice(0, 160) || undefined,
      userAgent: input.userAgent?.trim().slice(0, 300) || undefined,
      source: input.source?.trim().slice(0, 60) || undefined,
      scannedAt: new Date()
    });
    return true;
  } catch (error: any) {
    if (error?.code === 11000) return false;
    throw error;
  }
}

export async function getPublicProof() {
  const companyFilter = { slug: { $ne: 'qr-feedback-admin' } };
  const [companiesCount, reviewsCount, latestCompanies] = await Promise.all([
    Company.countDocuments(companyFilter),
    Review.countDocuments(),
    Company.find(companyFilter).select('name createdAt').sort({ createdAt: -1 }).limit(20).lean()
  ]);

  return {
    companiesCount,
    reviewsCount,
    trusts: latestCompanies.map((company) => ({
      id: company._id,
      companyName: company.name,
      createdAt: company.createdAt
    }))
  };
}
