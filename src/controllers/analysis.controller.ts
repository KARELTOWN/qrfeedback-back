import type { Request, Response } from 'express';
import { analyseReviews, buildRecommendations } from '../services/reviewAnalytics.service.js';
import { consumeRecommendationQuota } from '../services/recommendationRateLimit.service.js';
import { HttpError } from '../utils/httpError.js';

function analysisInput(body: Record<string, unknown>) {
  const startDate = typeof body.startDate === 'string' ? body.startDate : undefined;
  const endDate = typeof body.endDate === 'string' ? body.endDate : undefined;
  const comparisonStartDate = typeof body.comparisonStartDate === 'string' ? body.comparisonStartDate : undefined;
  const comparisonEndDate = typeof body.comparisonEndDate === 'string' ? body.comparisonEndDate : undefined;
  if (Boolean(startDate) !== Boolean(endDate)) {
    throw new HttpError(400, 'startDate et endDate doivent etre fournis ensemble.');
  }
  if (Boolean(comparisonStartDate) !== Boolean(comparisonEndDate)) {
    throw new HttpError(400, 'Les deux dates de comparaison doivent être fournies ensemble.');
  }
  if (startDate && endDate) return {
    qrCodeId: typeof body.qrCodeId === 'string' ? body.qrCodeId : undefined,
    startDate,
    endDate,
    comparisonStartDate,
    comparisonEndDate
  };
  const requestedWeeks = Number(body.weeks || 4);
  const weeks = [4, 6, 8].includes(requestedWeeks) ? requestedWeeks : 4;
  const end = new Date();
  const start = new Date(end);
  start.setDate(start.getDate() - weeks * 7);
  return {
    qrCodeId: typeof body.qrCodeId === 'string' ? body.qrCodeId : undefined,
    startDate: start.toISOString(),
    endDate: end.toISOString()
  };
}

export async function analyse(req: Request, res: Response) {
  res.json(await analyseReviews(req.company, analysisInput(req.body)));
}

export async function recommendations(req: Request, res: Response) {
  // const quota = await consumeRecommendationQuota(String(req.user._id));
  // res.set({ 'X-RateLimit-Remaining': String(quota.remaining), 'X-Reset-At': quota.resetAt.toISOString() });
  res.json({ recommendations: await buildRecommendations(req.body) });
}
