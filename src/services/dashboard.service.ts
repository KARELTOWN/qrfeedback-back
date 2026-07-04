import ExcelJS from 'exceljs';
import type { HydratedDocument } from 'mongoose';
import type { ICompany } from '../models/Company.js';
import { Review } from '../models/Review.js';
import { QrScan } from '../models/QrScan.js';
import { CompanyQrCode } from '../models/CompanyQrCode.js';
import { buildPagination, normalizePagination, type PaginationInput } from '../utils/pagination.js';
import { HttpError } from '../utils/httpError.js';
import { getCompanyFeedbackFormConfig, sanitizeFeedbackFormConfig } from './feedbackForm.service.js';
import { searchReviewsInTypesense, TypesenseRequestError, type ReviewSearchFilters } from './typesense.service.js';
import { sentimentSummary } from './reviewAnalytics.service.js';

type ReviewFilterInput = PaginationInput & {
  contactType?: string;
  contactValue?: string;
  query?: string;
  rating?: number;
  sentiment?: 'positive' | 'neutral' | 'negative';
  notificationStatus?: string;
  qrCodeId?: string;
  channel?: 'email' | 'telegram';
  moderationStatus?: 'published' | 'archived';
  includeArchived?: boolean;
  startDate?: string;
  endDate?: string;
};

type StatsInput = {
  startDate?: string;
  endDate?: string;
  qrCodeId?: string;
};

function normalizePhone(value: string) {
  return value.replace(/[^\d]/g, '');
}

function addDateFilter(filter: Record<string, unknown>, input: { startDate?: string; endDate?: string }) {
  const createdAt: Record<string, Date> = {};
  if (input.startDate) createdAt.$gte = new Date(input.startDate);
  if (input.endDate) {
    const end = new Date(input.endDate);
    end.setHours(23, 59, 59, 999);
    createdAt.$lte = end;
  }
  if (Object.keys(createdAt).length) filter.createdAt = createdAt;
}

function buildReviewFilter(company: HydratedDocument<ICompany>, input: ReviewFilterInput) {
  const filter: Record<string, unknown> = { company: company._id };
  const contactValue = String(input.contactValue || '').trim();
  const contactType = String(input.contactType || '').trim();
  const query = String(input.query || '').trim();

  if (!input.includeArchived) filter.moderationStatus = { $ne: 'archived' };
  if (input.moderationStatus === 'archived') filter.moderationStatus = 'archived';
  if (input.moderationStatus === 'published') filter.moderationStatus = { $ne: 'archived' };
  if (input.qrCodeId) filter.qrCode = input.qrCodeId;
  if (input.rating) filter.rating = input.rating;
  if (input.notificationStatus) filter.notificationStatus = input.notificationStatus;
  if (input.sentiment === 'positive') filter.rating = { $gte: 4 };
  if (input.sentiment === 'neutral') filter.rating = 3;
  if (input.sentiment === 'negative') filter.rating = { $lte: 2 };
  if (input.channel === 'email') filter.emailNotificationStatus = { $exists: true };
  if (input.channel === 'telegram') filter.notificationStatus = 'skipped';

  addDateFilter(filter, input);

  if (query) {
    const queryRegex = new RegExp(query.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i');
    filter.$or = [
      { serviceFeedback: queryRegex },
      { 'customAnswers.label': queryRegex },
      { 'customAnswers.value': queryRegex },
      { tags: queryRegex },
      { responseText: queryRegex },
      { internalNote: queryRegex }
    ];
  }

  if (contactType === 'email' && contactValue) {
    filter.customAnswers = { $elemMatch: { type: 'email', value: contactValue.toLowerCase() } };
  }

  if (contactType === 'phone' && contactValue) {
    filter.customAnswers = { $elemMatch: { type: 'phone', value: { $regex: `${normalizePhone(contactValue)}$` } } };
  }

  if (contactType === 'fullName' && contactValue) {
    filter.customAnswers = { $elemMatch: { type: 'fullName', value: contactValue } };
  }

  return filter;
}

function hasTypesenseReviewFilters(input: ReviewFilterInput) {
  return Boolean(input.query || input.rating || input.sentiment || input.notificationStatus || input.startDate || input.endDate || input.qrCodeId);
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

  const filter = buildReviewFilter(company, input);
  const reviews = await Review.find({ ...filter, _id: { $in: result.ids } }).populate('qrCode', 'label slug isActive');
  const byId = new Map(reviews.map((review) => [String(review._id), review]));

  return {
    reviews: result.ids.map((id) => byId.get(id)).filter(Boolean),
    pagination: buildPagination(result.total, pagination.page, pagination.limit),
    engine: 'typesense'
  };
}

export async function getCompanyReviews(company: HydratedDocument<ICompany>, input: ReviewFilterInput = {}) {
  if (hasTypesenseReviewFilters(input) && !input.contactType && !input.moderationStatus && !input.includeArchived) {
    const typesenseResult = await getCompanyReviewsFromTypesense(company, input);
    if (typesenseResult) return typesenseResult;
  }

  const pagination = normalizePagination(input);
  const filter = buildReviewFilter(company, input);
  const [total, reviews] = await Promise.all([
    Review.countDocuments(filter),
    Review.find(filter)
      .populate('qrCode', 'label slug isActive')
      .sort({ createdAt: -1 })
      .skip(pagination.skip)
      .limit(pagination.limit)
  ]);

  return {
    reviews,
    pagination: buildPagination(total, pagination.page, pagination.limit)
  };
}

function buildStatsMatch(company: HydratedDocument<ICompany>, input: StatsInput = {}) {
  const match: Record<string, unknown> = {
    company: company._id,
    moderationStatus: { $ne: 'archived' }
  };
  if (input.qrCodeId) match.qrCode = input.qrCodeId;
  addDateFilter(match, input);
  return match;
}

function buildScanMatch(company: HydratedDocument<ICompany>, input: StatsInput = {}) {
  const match: Record<string, unknown> = { company: company._id };
  if (input.qrCodeId) match.qrCode = input.qrCodeId;
  const scannedAt: Record<string, Date> = {};
  if (input.startDate) scannedAt.$gte = new Date(input.startDate);
  if (input.endDate) {
    const end = new Date(input.endDate);
    end.setHours(23, 59, 59, 999);
    scannedAt.$lte = end;
  }
  if (Object.keys(scannedAt).length) match.scannedAt = scannedAt;
  return match;
}

function conversionRate(reviewCount: number, scanCount: number) {
  if (!scanCount) return 0;
  const convertedReviews = Math.min(reviewCount, scanCount);
  return Number(((convertedReviews / scanCount) * 100).toFixed(2));
}

function notificationStatusLabel(status?: string) {
  return ({ pending: 'En attente', queued: 'En file', sent: 'Envoyée', delivered: 'Distribuée', skipped: 'Non envoyée', failed: 'Échec' } as Record<string, string>)[status || ''] || 'Non renseigné';
}

function buildPreviousStatsMatch(company: HydratedDocument<ICompany>, input: StatsInput = {}) {
  if (!input.startDate || !input.endDate) return null;
  const start = new Date(input.startDate);
  const end = new Date(input.endDate);
  end.setHours(23, 59, 59, 999);
  const duration = end.getTime() - start.getTime();
  const previousEnd = new Date(start.getTime() - 1);
  const previousStart = new Date(previousEnd.getTime() - duration);
  return buildStatsMatch(company, {
    qrCodeId: input.qrCodeId,
    startDate: previousStart.toISOString(),
    endDate: previousEnd.toISOString()
  });
}

export async function getCompanyStats(company: HydratedDocument<ICompany>, input: StatsInput = {}) {
  const match = buildStatsMatch(company, input);
  const scanMatch = buildScanMatch(company, input);
  const previousMatch = buildPreviousStatsMatch(company, input);

  const [summary, previousSummary, byQrCode, scanSummary, scansByQrCode] = await Promise.all([
    Review.aggregate([
      { $match: match },
      {
        $group: {
          _id: null,
          count: { $sum: 1 },
          averageRating: { $avg: '$rating' }
        }
      }
    ]),
    previousMatch ? Review.aggregate([
      { $match: previousMatch },
      { $group: { _id: null, count: { $sum: 1 }, averageRating: { $avg: '$rating' } } }
    ]) : Promise.resolve([]),
    Review.aggregate([
      { $match: { ...match, qrCode: { $exists: true } } },
      { $group: { _id: '$qrCode', count: { $sum: 1 }, averageRating: { $avg: '$rating' } } },
      { $sort: { count: -1 } },
      { $lookup: { from: 'companyqrcodes', localField: '_id', foreignField: '_id', as: 'qrCode' } },
      { $unwind: { path: '$qrCode', preserveNullAndEmptyArrays: true } },
      { $project: { _id: 1, count: 1, averageRating: 1, label: '$qrCode.label', slug: '$qrCode.slug', isActive: '$qrCode.isActive' } }
    ]),
    QrScan.aggregate([
      { $match: scanMatch },
      { $group: { _id: null, count: { $sum: 1 } } }
    ]),
    QrScan.aggregate([
      { $match: { ...scanMatch, qrCode: { $exists: true } } },
      { $group: { _id: '$qrCode', count: { $sum: 1 } } }
    ])
  ]);

  const current = summary[0];
  const previous = previousSummary[0];
  const scans = scanSummary[0]?.count || 0;
  const scansByQrCodeMap = new Map(scansByQrCode.map((row) => [String(row._id), row.count]));
  const currentAverage = Number((current?.averageRating || 0).toFixed(2));
  const previousAverage = Number((previous?.averageRating || 0).toFixed(2));

  return {
    company,
    count: current?.count || 0,
    scanCount: scans,
    conversionRate: conversionRate(current?.count || 0, scans),
    averageRating: currentAverage,
    ratingGoal: company.ratingGoal ?? 4.5,
    remainingMessages: null,
    remainingEmailNotifications: null,
    unlimitedAccess: true,
    comparison: {
      previousCount: previous?.count || 0,
      previousAverageRating: previousAverage,
      countDelta: (current?.count || 0) - (previous?.count || 0),
      averageRatingDelta: Number((currentAverage - previousAverage).toFixed(2))
    },
    byQrCode: byQrCode.map((row) => ({
      scanCount: scansByQrCodeMap.get(String(row._id)) || 0,
      conversionRate: conversionRate(row.count || 0, scansByQrCodeMap.get(String(row._id)) || 0),
      qrCodeId: row._id,
      label: row.label || 'QR',
      slug: row.slug,
      isActive: row.isActive !== false,
      count: row.count,
      averageRating: Number((row.averageRating || 0).toFixed(2))
    }))
  };
}

type QrTrendInput = { weeks: 4 | 6 | 8 };

function mondayStart(date: Date) {
  const result = new Date(date);
  const day = result.getDay() || 7;
  result.setHours(0, 0, 0, 0);
  result.setDate(result.getDate() - day + 1);
  return result;
}

export async function getQrTrends(company: HydratedDocument<ICompany>, { weeks }: QrTrendInput) {
  const periodEnd = new Date();
  const firstWeek = mondayStart(periodEnd);
  firstWeek.setDate(firstWeek.getDate() - (weeks - 1) * 7);
  const [qrCodes, reviews, scans] = await Promise.all([
    CompanyQrCode.find({ company: company._id }).sort({ createdAt: 1 }).lean(),
    Review.find({ company: company._id, qrCode: { $exists: true }, moderationStatus: { $ne: 'archived' }, createdAt: { $gte: firstWeek, $lte: periodEnd } }).select('qrCode rating createdAt serviceFeedback customAnswers').lean(),
    QrScan.find({ company: company._id, qrCode: { $exists: true }, scannedAt: { $gte: firstWeek, $lte: periodEnd } }).select('qrCode').lean()
  ]);
  const weekStarts = Array.from({ length: weeks }, (_, index) => {
    const start = new Date(firstWeek);
    start.setDate(start.getDate() + index * 7);
    return start;
  });

  return qrCodes.map((qrCode) => {
    const qrId = String(qrCode._id);
    const qrReviews = reviews.filter((review) => String(review.qrCode) === qrId);
    const values = qrReviews.map((review) => review.rating);
    const midpoint = firstWeek.getTime() + ((periodEnd.getTime() - firstWeek.getTime()) / 2);
    const firstHalf = qrReviews.filter((review) => review.createdAt.getTime() < midpoint);
    const secondHalf = qrReviews.filter((review) => review.createdAt.getTime() >= midpoint);
    const average = (items: typeof qrReviews) => items.length ? items.reduce((sum, review) => sum + review.rating, 0) / items.length : 0;
    const trendDelta = Number((average(secondHalf) - average(firstHalf)).toFixed(2));
    const direction = !firstHalf.length || !secondHalf.length || Math.abs(trendDelta) < 0.1 ? 'stable' : trendDelta > 0 ? 'up' : 'down';
    const points = weekStarts.map((start) => {
      const end = new Date(start); end.setDate(end.getDate() + 7);
      const bucket = qrReviews.filter((review) => review.createdAt >= start && review.createdAt < end);
      return { start: start.toISOString(), end: end.toISOString(), count: bucket.length, averageRating: bucket.length ? Number(average(bucket).toFixed(2)) : null };
    });
    const latestPoint = [...points].reverse().find((point) => point.averageRating !== null);
    const sentiment = sentimentSummary(qrReviews as unknown as Parameters<typeof sentimentSummary>[0]);
    return {
      qrCodeId: qrCode._id,
      label: qrCode.label || qrCode.slug,
      slug: qrCode.slug,
      isActive: qrCode.isActive !== false,
      currentRating: latestPoint?.averageRating || 0,
      positiveRate: sentiment.positiveRate,
      negativeRate: sentiment.negativeRate,
      trend: { direction, delta: direction === 'stable' ? 0 : trendDelta, method: 'first-half-vs-second-half' },
      sparkline: points,
      stats: { min: values.length ? Math.min(...values) : 0, max: values.length ? Math.max(...values) : 0, average: values.length ? Number(average(qrReviews).toFixed(2)) : 0, reviews: values.length, scans: scans.filter((scan) => String(scan.qrCode) === qrId).length }
    };
  });
}

export async function buildCompanyReviewsExcel(company: HydratedDocument<ICompany>, filter: Record<string, unknown> = {}) {
  const reviews = await Review.find({ company: company._id, ...filter })
    .populate('qrCode', 'label slug')
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
    { header: 'Experience', key: 'serviceFeedback', width: 45 },
    ...Array.from(customQuestionColumns.values()).map((column) => ({ ...column, width: 28 })),
    { header: 'Statut', key: 'moderationStatus', width: 16 },
    { header: 'Tags', key: 'tags', width: 28 },
    { header: 'Notification Telegram', key: 'telegramNotificationStatus', width: 22 },
    { header: 'Notification email', key: 'emailNotificationStatus', width: 22 },
    { header: 'QR Code', key: 'qrCode', width: 24 }
  ];

  for (const review of reviews) {
    const qrCode = review.qrCode as { label?: string } | undefined;
    const row: Record<string, unknown> = {
      createdAt: review.createdAt ? new Date(review.createdAt).toLocaleString('fr-FR') : '',
      rating: review.rating,
      serviceFeedback: review.serviceFeedback || '',
      moderationStatus: review.moderationStatus === 'archived' ? 'archived' : 'published',
      tags: (review.tags || []).join(', '),
      telegramNotificationStatus: notificationStatusLabel(review.notificationStatus),
      emailNotificationStatus: notificationStatusLabel(review.emailNotificationStatus),
      qrCode: qrCode ? `${qrCode.label || 'QR'}` : ''
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
      if (value.length > 40) cell.alignment = { wrapText: true, vertical: 'top' };
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
    { $match: { company: company._id, createdAt: { $gte: start, $lt: end }, moderationStatus: { $ne: 'archived' } } },
    { $group: { _id: { year: { $year: '$createdAt' }, month: { $month: '$createdAt' } }, count: { $sum: 1 } } }
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
  const match = buildStatsMatch(company, { startDate, endDate });
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
    emailEnabled: company.notificationPreferences?.emailEnabled !== false,
    telegramEnabled: company.notificationPreferences?.telegramEnabled !== false,
    smsEnabled: company.notificationPreferences?.smsEnabled === true,
    managerPhone: company.notificationPreferences?.managerPhone ?? null,
    badReviewThreshold: company.notificationPreferences?.badReviewThreshold ?? 2,
    autoReplyEnabled: company.notificationPreferences?.autoReplyEnabled !== false,
    autoReplyMode: company.notificationPreferences?.autoReplyMode === 'ai' ? 'ai' : 'manual',
    autoReplySatisfiedThreshold: company.notificationPreferences?.autoReplySatisfiedThreshold ?? 4,
    autoReplySatisfiedMessage: company.notificationPreferences?.autoReplySatisfiedMessage ?? '',
    autoReplyUnsatisfiedMessage: company.notificationPreferences?.autoReplyUnsatisfiedMessage ?? '',
  };
}

export async function updateNotificationPreferences(company: HydratedDocument<ICompany>, payload: unknown) {
  const source = payload && typeof payload === 'object' ? payload as Record<string, unknown> : {};
  const current = company.notificationPreferences ?? {};

  const managerPhone = typeof source.managerPhone === 'string'
    ? source.managerPhone.trim() || null
    : current.managerPhone ?? null;

  const badReviewThreshold = typeof source.badReviewThreshold === 'number' && source.badReviewThreshold >= 1 && source.badReviewThreshold <= 5
    ? Math.floor(source.badReviewThreshold)
    : current.badReviewThreshold ?? 2;

  const autoReplySatisfiedThreshold = typeof source.autoReplySatisfiedThreshold === 'number' && source.autoReplySatisfiedThreshold >= 1 && source.autoReplySatisfiedThreshold <= 5
    ? Math.floor(source.autoReplySatisfiedThreshold)
    : current.autoReplySatisfiedThreshold ?? 4;

  company.set('notificationPreferences', {
    emailEnabled: typeof source.emailEnabled === 'boolean' ? source.emailEnabled : current.emailEnabled !== false,
    telegramEnabled: typeof source.telegramEnabled === 'boolean' ? source.telegramEnabled : current.telegramEnabled !== false,
    smsEnabled: typeof source.smsEnabled === 'boolean' ? source.smsEnabled : current.smsEnabled === true,
    managerPhone,
    badReviewThreshold,
    autoReplyEnabled: typeof source.autoReplyEnabled === 'boolean' ? source.autoReplyEnabled : current.autoReplyEnabled !== false,
    autoReplyMode: source.autoReplyMode === 'ai' ? 'ai' : source.autoReplyMode === 'manual' ? 'manual' : (current.autoReplyMode ?? 'manual'),
    autoReplySatisfiedThreshold,
    autoReplySatisfiedMessage: typeof source.autoReplySatisfiedMessage === 'string' ? source.autoReplySatisfiedMessage.trim() : current.autoReplySatisfiedMessage ?? '',
    autoReplyUnsatisfiedMessage: typeof source.autoReplyUnsatisfiedMessage === 'string' ? source.autoReplyUnsatisfiedMessage.trim() : current.autoReplyUnsatisfiedMessage ?? '',
  });
  await company.save();
  return getNotificationPreferences(company);
}

export function getReviewRedirectConfig(company: HydratedDocument<ICompany>) {
  return {
    enabled: company.reviewRedirectConfig?.enabled === true,
    goodRatingThreshold: company.reviewRedirectConfig?.goodRatingThreshold ?? 4,
    redirectUrl: company.reviewRedirectConfig?.redirectUrl ?? null,
  };
}

export async function updateReviewRedirectConfig(company: HydratedDocument<ICompany>, payload: unknown) {
  const source = payload && typeof payload === 'object' ? payload as Record<string, unknown> : {};
  const current = company.reviewRedirectConfig ?? {};

  const redirectUrl = typeof source.redirectUrl === 'string' ? source.redirectUrl.trim().slice(0, 500) || null : current.redirectUrl ?? null;
  const goodRatingThreshold = typeof source.goodRatingThreshold === 'number' && source.goodRatingThreshold >= 1 && source.goodRatingThreshold <= 5
    ? Math.floor(source.goodRatingThreshold)
    : current.goodRatingThreshold ?? 4;

  company.set('reviewRedirectConfig', {
    enabled: typeof source.enabled === 'boolean' ? source.enabled : current.enabled === true,
    goodRatingThreshold,
    redirectUrl,
  });
  await company.save();
  return getReviewRedirectConfig(company);
}

export async function updateRatingGoal(company: HydratedDocument<ICompany>, payload: unknown) {
  const source = payload && typeof payload === 'object' ? payload as Record<string, unknown> : {};
  const value = Number(source.ratingGoal);
  if (!Number.isFinite(value) || value < 1 || value > 5) {
    throw new HttpError(400, "L'objectif doit être une note comprise entre 1 et 5.");
  }
  company.set('ratingGoal', Math.round(value * 10) / 10);
  await company.save();
  return { ratingGoal: company.ratingGoal };
}

export async function updateReviewModeration(company: HydratedDocument<ICompany>, reviewId: string, payload: unknown) {
  const source = payload && typeof payload === 'object' ? payload as Record<string, unknown> : {};
  const review = await Review.findOne({ _id: reviewId, company: company._id });
  if (!review) throw new HttpError(404, 'Avis introuvable.');

  const allowedStatuses = new Set(['published', 'archived']);
  if (!allowedStatuses.has(String(review.moderationStatus))) {
    review.moderationStatus = 'published';
  }
  if (typeof source.moderationStatus === 'string' && allowedStatuses.has(source.moderationStatus)) {
    review.moderationStatus = source.moderationStatus as typeof review.moderationStatus;
  }
  if (Array.isArray(source.tags)) {
    review.tags = source.tags.map((tag) => String(tag).trim()).filter(Boolean).slice(0, 12);
  }
  if (typeof source.internalNote === 'string') review.internalNote = source.internalNote.trim().slice(0, 2000);
  if (typeof source.responseText === 'string') {
    review.responseText = source.responseText.trim().slice(0, 2000);
    review.respondedAt = review.responseText ? new Date() : undefined;
  }

  await review.save();
  return review;
}
