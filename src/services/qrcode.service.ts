import type { HydratedDocument } from 'mongoose';
import { env } from '../config/env.js';
import type { ICompany } from '../models/Company.js';
import { CompanyQrCode } from '../models/CompanyQrCode.js';
import { Review } from '../models/Review.js';
import { createSlug } from '../utils/slug.js';
import { HttpError } from '../utils/httpError.js';
import { buildPagination, normalizePagination, type PaginationInput } from '../utils/pagination.js';
import { generateQrDataUrl } from './qr.service.js';

type CreateCompanyQrCodeInput = {
  company: HydratedDocument<ICompany>;
  whatsappNumber?: string;
  label?: string;
};

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
    { $match: { company: company._id, qrCode: { $in: qrCodeIds } } },
    { $group: { _id: '$qrCode', count: { $sum: 1 } } }
  ]);

  const countsByQrCode = new Map(reviewCounts.map((item) => [String(item._id), item.count]));

  return {
    qrCodes: qrCodes.map((qrCode) => ({
      ...qrCode,
      reviewCount: countsByQrCode.get(String(qrCode._id)) || 0
    })),
    pagination: buildPagination(total, pagination.page, pagination.limit)
  };
}

export async function createCompanyQrCode({ company, whatsappNumber, label }: CreateCompanyQrCodeInput) {
  const normalizedWhatsappNumber = whatsappNumber?.trim() || undefined;
  const slug = createSlug(`${company.name}-${label || normalizedWhatsappNumber || 'qr'}`);
  const feedbackUrl = `${env.frontendUrl}/avis/${slug}`;
  const qrCodeDataUrl = await generateQrDataUrl(feedbackUrl);

  return CompanyQrCode.create({
    company: company._id,
    whatsappNumber: normalizedWhatsappNumber,
    label,
    slug,
    feedbackUrl,
    qrCodeDataUrl
  });
}

export async function updateCompanyQrCodeNotifications(company: HydratedDocument<ICompany>, qrCodeId: string, payload: unknown) {
  const source = payload && typeof payload === 'object' ? payload as Record<string, unknown> : {};
  const qrCode = await CompanyQrCode.findOne({ _id: qrCodeId, company: company._id });
  if (!qrCode) throw new HttpError(404, 'QR Code introuvable.');

  qrCode.set('notificationPreferences', {
    whatsappEnabled: typeof source.whatsappEnabled === 'boolean' ? source.whatsappEnabled : qrCode.notificationPreferences?.whatsappEnabled !== false,
    emailEnabled: typeof source.emailEnabled === 'boolean' ? source.emailEnabled : qrCode.notificationPreferences?.emailEnabled !== false,
    telegramEnabled: typeof source.telegramEnabled === 'boolean' ? source.telegramEnabled : qrCode.notificationPreferences?.telegramEnabled !== false
  });
  await qrCode.save();
  return qrCode;
}
