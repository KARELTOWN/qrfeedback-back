import type { HydratedDocument } from 'mongoose';
import { Company } from '../models/Company.js';
import { CompanyQrCode } from '../models/CompanyQrCode.js';
import { Review, type IReview } from '../models/Review.js';
import { HttpError } from '../utils/httpError.js';

const DEFAULT_LIMIT = 12;
const MAX_LIMIT = 30;

function abbreviateName(fullName: string) {
  const parts = fullName.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return 'Client';
  const lastInitial = parts.length > 1 ? `${parts[parts.length - 1][0]}.` : '';
  return [parts[0], lastInitial].filter(Boolean).join(' ');
}

function extractDisplayName(review: HydratedDocument<IReview>) {
  const fullNameAnswer = review.customAnswers?.find((answer) => answer.type === 'fullName');
  if (typeof fullNameAnswer?.value === 'string' && fullNameAnswer.value.trim()) {
    return abbreviateName(fullNameAnswer.value);
  }
  return 'Client';
}

function serializeReview(review: HydratedDocument<IReview>) {
  return {
    id: review._id,
    rating: review.rating,
    text: review.serviceFeedback || '',
    authorName: extractDisplayName(review),
    createdAt: review.createdAt
  };
}

async function fetchPublishedReviews(filter: Record<string, unknown>, limit: number) {
  const reviews = await Review.find({ ...filter, moderationStatus: 'published' })
    .sort({ createdAt: -1 })
    .limit(limit)
    .select('rating serviceFeedback customAnswers createdAt');

  return reviews.map(serializeReview);
}

export async function getPublicTestimonials(slug: string, limit?: number) {
  const safeLimit = Math.min(Math.max(1, limit || DEFAULT_LIMIT), MAX_LIMIT);

  const company = await Company.findOne({ slug }).select('name');
  if (company) {
    return {
      companyName: company.name,
      reviews: await fetchPublishedReviews({ company: company._id }, safeLimit)
    };
  }

  const qrCode = await CompanyQrCode.findOne({ slug, isActive: { $ne: false } });
  if (!qrCode) throw new HttpError(404, 'Entreprise introuvable.');

  const qrCompany = await Company.findById(qrCode.company).select('name');
  if (!qrCompany) throw new HttpError(404, 'Entreprise introuvable.');

  return {
    companyName: qrCompany.name,
    reviews: await fetchPublishedReviews({ company: qrCode.company, qrCode: qrCode._id }, safeLimit)
  };
}
