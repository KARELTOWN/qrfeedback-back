import type { Request, Response } from 'express';
import * as dashboardService from '../services/dashboard.service.js';
import * as reviewAnalyticsService from '../services/reviewAnalytics.service.js';

export async function getReviews(req: Request, res: Response) {
  const reviews = await dashboardService.getCompanyReviews(req.company, {
    page: Number(req.query.page),
    limit: Number(req.query.limit),
    contactType: req.query.contactType ? String(req.query.contactType) : undefined,
    contactValue: req.query.contactValue ? String(req.query.contactValue) : undefined,
    query: req.query.q ? String(req.query.q) : undefined,
    rating: req.query.rating ? Number(req.query.rating) : undefined,
    sentiment: req.query.sentiment ? String(req.query.sentiment) as 'positive' | 'neutral' | 'negative' : undefined,
    notificationStatus: req.query.notificationStatus ? String(req.query.notificationStatus) : undefined,
    qrCodeId: req.query.qrCodeId ? String(req.query.qrCodeId) : undefined,
    channel: req.query.channel ? String(req.query.channel) as 'email' | 'telegram' : undefined,
    moderationStatus: req.query.moderationStatus ? String(req.query.moderationStatus) as 'published' | 'archived' : undefined,
    includeArchived: req.query.includeArchived === 'true',
    startDate: req.query.startDate ? String(req.query.startDate) : undefined,
    endDate: req.query.endDate ? String(req.query.endDate) : undefined
  });
  res.json(reviews);
}

export async function getStats(req: Request, res: Response) {
  const stats = await dashboardService.getCompanyStats(req.company, {
    qrCodeId: req.query.qrCodeId ? String(req.query.qrCodeId) : undefined,
    startDate: req.query.startDate ? String(req.query.startDate) : undefined,
    endDate: req.query.endDate ? String(req.query.endDate) : undefined
  });
  res.json(stats);
}

export async function getQrTrends(req: Request, res: Response) {
  const requestedWeeks = Number(req.query.weeks || 4);
  const weeks = ([4, 6, 8].includes(requestedWeeks) ? requestedWeeks : 4) as 4 | 6 | 8;
  res.json({ weeks, items: await dashboardService.getQrTrends(req.company, { weeks }) });
}

export async function exportExcel(req: Request, res: Response) {
  const buffer = await dashboardService.buildCompanyReviewsExcel(req.company);
  res.header('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
  res.attachment('avis.xlsx');
  res.send(buffer);
}

export async function getMonthlyEvolution(req: Request, res: Response) {
  const years = String(req.query.years || '')
    .split(',')
    .map((year) => Number(year))
    .filter((year) => Number.isInteger(year) && year >= 2000 && year <= 2100);
  const data = await dashboardService.getMonthlyReviewEvolution(req.company, years);
  res.json(data);
}

export async function getRatingDistribution(req: Request, res: Response) {
  const data = await dashboardService.getRatingDistribution(
    req.company,
    req.query.startDate ? String(req.query.startDate) : undefined,
    req.query.endDate ? String(req.query.endDate) : undefined
  );
  res.json(data);
}

export async function getFeedbackFormConfig(req: Request, res: Response) {
  res.json(dashboardService.getFeedbackFormConfig(req.company));
}

export async function updateFeedbackFormConfig(req: Request, res: Response) {
  res.json(await dashboardService.updateFeedbackFormConfig(req.company, req.body));
}

export async function getNotificationPreferences(req: Request, res: Response) {
  res.json(dashboardService.getNotificationPreferences(req.company));
}

export async function updateNotificationPreferences(req: Request, res: Response) {
  res.json(await dashboardService.updateNotificationPreferences(req.company, req.body));
}

export async function getAiOverview(req: Request, res: Response) {
  res.json(await reviewAnalyticsService.getAiOverview(req.company, {
    qrCodeId: req.query.qrCodeId ? String(req.query.qrCodeId) : undefined,
    startDate: req.query.startDate ? String(req.query.startDate) : undefined,
    endDate: req.query.endDate ? String(req.query.endDate) : undefined
  }));
}

export async function searchAiReviews(req: Request, res: Response) {
  res.json(await reviewAnalyticsService.searchAiReviews(req.company, {
    page: Number(req.query.page),
    limit: Number(req.query.limit),
    query: req.query.q ? String(req.query.q) : undefined,
    qrCodeId: req.query.qrCodeId ? String(req.query.qrCodeId) : undefined,
    startDate: req.query.startDate ? String(req.query.startDate) : undefined,
    endDate: req.query.endDate ? String(req.query.endDate) : undefined
  }));
}

export async function reindexAiReviews(req: Request, res: Response) {
  res.json(await reviewAnalyticsService.rebuildAiIndex(req.company));
}

export async function updateReviewModeration(req: Request, res: Response) {
  res.json(await dashboardService.updateReviewModeration(req.company, String(req.params.reviewId), req.body));
}
