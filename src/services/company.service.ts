import { env } from '../config/env.js';
import { Company } from '../models/Company.js';
import { CompanyQrCode } from '../models/CompanyQrCode.js';
import { Review } from '../models/Review.js';
import { HttpError } from '../utils/httpError.js';
import { createSlug } from '../utils/slug.js';
import { getCompanyFeedbackFormConfig } from './feedbackForm.service.js';
import { generateQrDataUrl } from './qr.service.js';
import { buildQrPdfBuffer } from './pdf.service.js';
import { sendMail } from './mail.service.js';

type RegisterCompanyInput = {
  name: string;
  email: string;
  whatsappNumber: string;
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

export async function registerCompany({ name, email, whatsappNumber }: RegisterCompanyInput) {
  const slug = createSlug(name);
  const feedbackUrl = `${env.frontendUrl}/avis/${slug}`;
  const qrCodeDataUrl = await generateQrDataUrl(feedbackUrl);

  const company = await Company.create({
    name,
    email,
    whatsappNumber,
    slug,
    feedbackUrl,
    qrCodeDataUrl,
    freeMessagesLimit: env.freeWhatsappMessages
  });

  const pdf = await buildQrPdfBuffer({ companyName: name, feedbackUrl, qrCodeDataUrl });
  await sendMail({
    to: email,
    subject: 'Votre QR Code de collecte d’avis',
    html: `
      <p>Bonjour ${name},</p>
      <p>Votre lien de collecte est prêt : <a href="${feedbackUrl}">${feedbackUrl}</a>.</p>
      <p>Vous bénéficiez de ${env.freeWhatsappMessages} notifications WhatsApp offertes.</p>
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

  const qrCode = await CompanyQrCode.findOne({ slug });
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
