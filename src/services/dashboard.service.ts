import ExcelJS from 'exceljs';
import type { HydratedDocument } from 'mongoose';
import type { ICompany } from '../models/Company.js';
import { Review } from '../models/Review.js';
import { buildPagination, normalizePagination, type PaginationInput } from '../utils/pagination.js';
import { getCompanyFeedbackFormConfig, sanitizeFeedbackFormConfig } from './feedbackForm.service.js';
import { searchReviewsInTypesense, TypesenseRequestError, type ReviewSearchFilters } from './typesense.service.js';

type ReviewFilterInput = PaginationInput & {
  contactType?: string;
  contactValue?: string;
  query?: string;
  rating?: number;
  sentiment?: 'positive' | 'neutral' | 'negative';
  notificationStatus?: string;
  startDate?: string;
  endDate?: string;
};

function normalizePhone(value: string) {
  return value.replace(/[^\d]/g, '');
}

function buildReviewFilter(company: HydratedDocument<ICompany>, input: ReviewFilterInput) {
  const filter: Record<string, unknown> = { company: company._id };
  const contactValue = String(input.contactValue || '').trim();
  const contactType = String(input.contactType || '').trim();
  const query = String(input.query || '').trim();

  if (input.rating) filter.rating = input.rating;
  if (input.notificationStatus) filter.notificationStatus = input.notificationStatus;
  if (input.sentiment === 'positive') filter.rating = { $gte: 4 };
  if (input.sentiment === 'neutral') filter.rating = 3;
  if (input.sentiment === 'negative') filter.rating = { $lte: 2 };

  const createdAt: Record<string, Date> = {};
  if (input.startDate) createdAt.$gte = new Date(input.startDate);
  if (input.endDate) {
    const end = new Date(input.endDate);
    end.setHours(23, 59, 59, 999);
    createdAt.$lte = end;
  }
  if (Object.keys(createdAt).length) filter.createdAt = createdAt;

  if (query) {
    const queryRegex = new RegExp(query.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i');
    filter.$or = [
      { serviceFeedback: queryRegex },
      { 'customAnswers.label': queryRegex },
      { 'customAnswers.value': queryRegex }
    ];
  }

  if (contactType === 'email' && contactValue) {
    filter.customAnswers = {
      $elemMatch: {
        type: 'email',
        value: contactValue.toLowerCase()
      }
    };
  }

  if (contactType === 'phone' && contactValue) {
    const phoneDigits = normalizePhone(contactValue);
    filter.customAnswers = {
      $elemMatch: {
        type: 'phone',
        value: { $regex: `${phoneDigits}$` }
      }
    };
  }

  if (contactType === 'fullName' && contactValue) {
    filter.customAnswers = {
      $elemMatch: {
        type: 'fullName',
        value: contactValue
      }
    };
  }

  return filter;
}

function hasTypesenseReviewFilters(input: ReviewFilterInput) {
  return Boolean(input.query || input.rating || input.sentiment || input.notificationStatus || input.startDate || input.endDate);
}

async function getCompanyReviewsFromTypesense(company: HydratedDocument<ICompany>, input: ReviewFilterInput) {
  const pagination = normalizePagination(input);
  const result = await searchReviewsInTypesense(String(company._id), input as ReviewSearchFilters, pagination.page, pagination.limit).catch((error) => {
    if (!(error instanceof TypesenseRequestError && error.status === 404)) {
      console.warn('[typesense:reviews-search:failed]', {
        companyId: String(company._id),
        error: error instanceof Error ? error.message : String(error)
      });
    }
    return null;
  });
  if (!result) return null;

  const reviews = await Review.find({ _id: { $in: result.ids }, company: company._id }).populate('qrCode', 'whatsappNumber label slug');
  const byId = new Map(reviews.map((review) => [String(review._id), review]));

  return {
    reviews: result.ids.map((id) => byId.get(id)).filter(Boolean),
    pagination: buildPagination(result.total, pagination.page, pagination.limit),
    engine: 'typesense'
  };
}

export async function getCompanyReviews(company: HydratedDocument<ICompany>, input: ReviewFilterInput = {}) {
  if (hasTypesenseReviewFilters(input) && !input.contactType) {
    const typesenseResult = await getCompanyReviewsFromTypesense(company, input);
    if (typesenseResult) return typesenseResult;
  }

  const pagination = normalizePagination(input);
  const filter = buildReviewFilter(company, input);
  const [total, reviews] = await Promise.all([
    Review.countDocuments(filter),
    Review.find(filter)
    .populate('qrCode', 'whatsappNumber label slug')
    .sort({ createdAt: -1 })
      .skip(pagination.skip)
      .limit(pagination.limit)
  ]);

  return {
    reviews,
    pagination: buildPagination(total, pagination.page, pagination.limit)
  };
}

export async function getCompanyStats(company: HydratedDocument<ICompany>) {
  const [summary] = await Review.aggregate([
    { $match: { company: company._id } },
    {
      $group: {
        _id: null,
        count: { $sum: 1 },
        averageRating: { $avg: '$rating' }
      }
    }
  ]);

  return {
    company,
    count: summary?.count || 0,
    averageRating: Number((summary?.averageRating || 0).toFixed(2)),
    remainingMessages: null,
    remainingEmailNotifications: null,
    unlimitedAccess: true
  };
}

export async function buildCompanyReviewsExcel(company: HydratedDocument<ICompany>) {
  const reviews = await Review.find({ company: company._id })
    .populate('qrCode', 'whatsappNumber label slug')
    .sort({ createdAt: -1 })
    .lean();

  const workbook = new ExcelJS.Workbook();
  const sheet = workbook.addWorksheet('Avis');
  const customQuestionColumns = new Map<string, { header: string; key: string }>();

  for (const review of reviews) {
    for (const answer of review.customAnswers || []) {
      if (!answer?.questionId || !answer?.label) continue;
      if (!customQuestionColumns.has(answer.questionId)) {
        customQuestionColumns.set(answer.questionId, {
          header: answer.label,
          key: `custom_${customQuestionColumns.size}`
        });
      }
    }
  }

  sheet.columns = [
    { header: 'Date', key: 'createdAt', width: 18 },
    { header: 'Note', key: 'rating', width: 10 },
    { header: 'Expérience', key: 'serviceFeedback', width: 45 },
    ...Array.from(customQuestionColumns.values()).map((column) => ({ ...column, width: 28 })),
    { header: 'Statut notification', key: 'notificationStatus', width: 22 },
    { header: 'QR Code', key: 'qrCode', width: 24 }
  ];

  for (const review of reviews) {
    const qrCode = review.qrCode as { label?: string; whatsappNumber?: string } | undefined;
    const row: Record<string, unknown> = {
      createdAt: review.createdAt ? new Date(review.createdAt).toLocaleString('fr-FR') : '',
      rating: review.rating,
      serviceFeedback: review.serviceFeedback || '',
      notificationStatus: review.notificationStatus,
      qrCode: qrCode ? `${qrCode.label || 'QR'} - ${qrCode.whatsappNumber || ''}` : ''
    };

    for (const answer of review.customAnswers || []) {
      const column = customQuestionColumns.get(answer.questionId);
      if (column) row[column.key] = answer.value ?? '';
    }

    sheet.addRow(row);
  }

  sheet.getRow(1).font = { bold: true };
  sheet.getRow(1).alignment = { vertical: 'middle' };

  for (const column of sheet.columns) {
    let maxLength = String(column.header || '').length;
    column.eachCell?.({ includeEmpty: true }, (cell) => {
      const value = cell.value ? String(cell.value) : '';
      maxLength = Math.max(maxLength, Math.min(value.length, 60));
      if (value.length > 40) {
        cell.alignment = { wrapText: true, vertical: 'top' };
      }
    });
    column.width = Math.min(Math.max(maxLength + 2, Number(column.width || 12)), 50);
  }

  return workbook.xlsx.writeBuffer();
}
export async function getMonthlyReviewEvolution(company: HydratedDocument<ICompany>, years: number[]) {
  const currentYear = new Date().getFullYear();
  const safeYears = years.length ? years : [currentYear];
  const start = new Date(Math.min(...safeYears), 0, 1);
  const end = new Date(Math.max(...safeYears) + 1, 0, 1);

  const rows = await Review.aggregate([
    { $match: { company: company._id, createdAt: { $gte: start, $lt: end } } },
    {
      $group: {
        _id: { year: { $year: '$createdAt' }, month: { $month: '$createdAt' } },
        count: { $sum: 1 }
      }
    }
  ]);

  return safeYears.map((year) => ({
    year,
    months: Array.from({ length: 12 }, (_, index) => {
      const month = index + 1;
      const row = rows.find((item) => item._id.year === year && item._id.month === month);
      return { month, count: row?.count || 0 };
    })
  }));
}

export async function getRatingDistribution(company: HydratedDocument<ICompany>, startDate?: string, endDate?: string) {
  const match: Record<string, unknown> = { company: company._id };
  const createdAt: Record<string, Date> = {};

  if (startDate) createdAt.$gte = new Date(startDate);
  if (endDate) {
    const end = new Date(endDate);
    end.setHours(23, 59, 59, 999);
    createdAt.$lte = end;
  }
  if (Object.keys(createdAt).length) match.createdAt = createdAt;

  const rows = await Review.aggregate([
    { $match: match },
    { $group: { _id: '$rating', count: { $sum: 1 } } }
  ]);

  return [1, 2, 3, 4, 5].map((rating) => ({
    rating,
    count: rows.find((item) => item._id === rating)?.count || 0
  }));
}

export function getFeedbackFormConfig(company: HydratedDocument<ICompany>) {
  return getCompanyFeedbackFormConfig(company);
}

export async function updateFeedbackFormConfig(company: HydratedDocument<ICompany>, payload: unknown) {
  company.set('feedbackFormConfig', sanitizeFeedbackFormConfig(payload, company.name));
  await company.save();
  return getCompanyFeedbackFormConfig(company);
}

export function getNotificationPreferences(company: HydratedDocument<ICompany>) {
  return {
    whatsappEnabled: company.notificationPreferences?.whatsappEnabled !== false,
    emailEnabled: company.notificationPreferences?.emailEnabled !== false,
    telegramEnabled: company.notificationPreferences?.telegramEnabled !== false
  };
}

export async function updateNotificationPreferences(company: HydratedDocument<ICompany>, payload: unknown) {
  const source = payload && typeof payload === 'object' ? payload as Record<string, unknown> : {};
  company.set('notificationPreferences', {
    whatsappEnabled: typeof source.whatsappEnabled === 'boolean' ? source.whatsappEnabled : company.notificationPreferences?.whatsappEnabled !== false,
    emailEnabled: typeof source.emailEnabled === 'boolean' ? source.emailEnabled : company.notificationPreferences?.emailEnabled !== false,
    telegramEnabled: typeof source.telegramEnabled === 'boolean' ? source.telegramEnabled : company.notificationPreferences?.telegramEnabled !== false
  });
  await company.save();
  return getNotificationPreferences(company);
}
