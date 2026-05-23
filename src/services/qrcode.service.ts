import type { HydratedDocument, Types } from 'mongoose';
import { env } from '../config/env.js';
import type { ICompany } from '../models/Company.js';
import { CompanyQrCode } from '../models/CompanyQrCode.js';
import { Review } from '../models/Review.js';
import { createSlug } from '../utils/slug.js';
import { buildPagination, normalizePagination, type PaginationInput } from '../utils/pagination.js';
import { generateQrDataUrl } from './qr.service.js';
import {
  ensureDefaultQrFormListMapping,
  getQrFormListMapping,
  upsertQrFormListMapping
} from './qrFormListMapping.service.js';

type CreateCompanyQrCodeInput = {
  company: HydratedDocument<ICompany>;
  whatsappNumber: string;
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
  const slug = createSlug(`${company.name}-${whatsappNumber}`);
  const feedbackUrl = `${env.frontendUrl}/avis/${slug}`;
  const qrCodeDataUrl = await generateQrDataUrl(feedbackUrl);

  const qrCode = await CompanyQrCode.create({
    company: company._id,
    whatsappNumber,
    label,
    slug,
    feedbackUrl,
    qrCodeDataUrl
  });
  await ensureDefaultQrFormListMapping(company, qrCode);
  return qrCode;
}

export function getQrCodeListMapping(company: HydratedDocument<ICompany>, qrCodeId: string) {
  return getQrFormListMapping(company, qrCodeId);
}

export function upsertQrCodeListMapping(
  company: HydratedDocument<ICompany>,
  qrCodeId: string,
  input: {
    listId?: string;
    fieldMappings?: Array<{
      formFieldKey: string;
      formFieldLabel?: string;
      listAttributeKey: string;
      createIfMissing?: boolean;
    }>;
    autoCreateContact?: boolean;
    autoAddToList?: boolean;
    createdBy?: Types.ObjectId | string;
  }
) {
  return upsertQrFormListMapping({
    company,
    qrCodeId,
    listId: input.listId,
    fieldMappings: input.fieldMappings,
    autoCreateContact: input.autoCreateContact,
    autoAddToList: input.autoAddToList,
    createdBy: input.createdBy
  });
}
