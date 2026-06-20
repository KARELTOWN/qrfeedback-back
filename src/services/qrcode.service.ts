import type { HydratedDocument } from 'mongoose';
import { env } from '../config/env.js';
import type { ICompany } from '../models/Company.js';
import { CompanyQrCode } from '../models/CompanyQrCode.js';
import { Review } from '../models/Review.js';
import { QrScan } from '../models/QrScan.js';
import { createSlug } from '../utils/slug.js';
import { HttpError } from '../utils/httpError.js';
import { buildPagination, normalizePagination, type PaginationInput } from '../utils/pagination.js';
import { generateQrDataUrl } from './qr.service.js';
import { buildQrPdfBuffer } from './pdf.service.js';

type CreateCompanyQrCodeInput = {
  company: HydratedDocument<ICompany>;
  label?: string;
};

function conversionRate(reviewCount: number, scanCount: number) {
  if (!scanCount) return 0;
  const convertedReviews = Math.min(reviewCount, scanCount);
  return Number(((convertedReviews / scanCount) * 100).toFixed(2));
}

export async function listCompanyQrCodes(company: HydratedDocument<ICompany>, input: PaginationInput = {}) {
  const pagination = normalizePagination(input);
  const [total, qrCodes] = await Promise.all([
    CompanyQrCode.countDocuments({ company: company._id }),
    CompanyQrCode.find({ company: company._id })
      .sort({ createdAt: -1 })
      .skip(pagination.skip)
      .limit(pagination.limit)
      .lean()
  ]);
  const qrCodeIds = qrCodes.map((qrCode) => qrCode._id);
  const reviewCounts = await Review.aggregate([
    { $match: { company: company._id, qrCode: { $in: qrCodeIds }, moderationStatus: { $ne: 'archived' } } },
    { $group: { _id: '$qrCode', count: { $sum: 1 }, averageRating: { $avg: '$rating' } } }
  ]);
  const scanCounts = await QrScan.aggregate([
    { $match: { company: company._id, qrCode: { $in: qrCodeIds } } },
    { $group: { _id: '$qrCode', count: { $sum: 1 } } }
  ]);

  const statsByQrCode = new Map(reviewCounts.map((item) => [String(item._id), item]));
  const scansByQrCode = new Map(scanCounts.map((item) => [String(item._id), item.count]));

  return {
    qrCodes: qrCodes.map((qrCode) => {
      const stats = statsByQrCode.get(String(qrCode._id));
      const scanCount = scansByQrCode.get(String(qrCode._id)) || qrCode.scanCount || 0;
      const reviewCount = stats?.count || 0;
      return {
        ...qrCode,
        scanCount,
        conversionRate: conversionRate(reviewCount, scanCount),
        reviewCount,
        averageRating: Number((stats?.averageRating || 0).toFixed(2))
      };
    }),
    pagination: buildPagination(total, pagination.page, pagination.limit)
  };
}

export async function getCompanyQrCode(company: HydratedDocument<ICompany>, qrCodeId: string) {
  const qrCode = await CompanyQrCode.findOne({ _id: qrCodeId, company: company._id });
  if (!qrCode) throw new HttpError(404, 'QR Code introuvable.');
  return qrCode;
}

export async function createCompanyQrCode({ company, label }: CreateCompanyQrCodeInput) {
  const slug = createSlug(`${company.name}-${label || 'qr'}`);
  const feedbackUrl = `${env.frontendUrl}/avis/${slug}`;
  const qrCodeDataUrl = await generateQrDataUrl(feedbackUrl);

  return CompanyQrCode.create({
    company: company._id,
    label,
    slug,
    feedbackUrl,
    qrCodeDataUrl,
    isActive: true
  });
}

export async function updateCompanyQrCode(company: HydratedDocument<ICompany>, qrCodeId: string, payload: unknown) {
  const source = payload && typeof payload === 'object' ? payload as Record<string, unknown> : {};
  const qrCode = await getCompanyQrCode(company, qrCodeId);

  if (typeof source.label === 'string') {
    qrCode.label = source.label.trim() || undefined;
  }

  if (typeof source.isActive === 'boolean') {
    qrCode.isActive = source.isActive;
    qrCode.disabledAt = source.isActive ? undefined : new Date();
  }

  await qrCode.save();
  return qrCode;
}

export async function disableCompanyQrCode(company: HydratedDocument<ICompany>, qrCodeId: string) {
  return updateCompanyQrCode(company, qrCodeId, { isActive: false });
}

export async function buildCompanyQrCodePdf(company: HydratedDocument<ICompany>, qrCodeId: string) {
  const qrCode = await getCompanyQrCode(company, qrCodeId);
  const pdf = await buildQrPdfBuffer({
    companyName: qrCode.label ? `${company.name} - ${qrCode.label}` : company.name,
    feedbackUrl: qrCode.feedbackUrl,
    qrCodeDataUrl: qrCode.qrCodeDataUrl
  });

  return { qrCode, pdf };
}

export async function updateCompanyQrCodeNotifications(company: HydratedDocument<ICompany>, qrCodeId: string, payload: unknown) {
  const source = payload && typeof payload === 'object' ? payload as Record<string, unknown> : {};
  const qrCode = await getCompanyQrCode(company, qrCodeId);

  qrCode.set('notificationPreferences', {
    emailEnabled: typeof source.emailEnabled === 'boolean' ? source.emailEnabled : qrCode.notificationPreferences?.emailEnabled !== false,
    telegramEnabled: typeof source.telegramEnabled === 'boolean' ? source.telegramEnabled : qrCode.notificationPreferences?.telegramEnabled !== false
  });
  await qrCode.save();
  return qrCode;
}
