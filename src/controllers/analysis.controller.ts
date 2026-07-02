import type { Request, Response } from 'express';
import { analyseReviews, buildRecommendations, getReviewsForTopic } from '../services/reviewAnalytics.service.js';
import { consumeRecommendationQuota } from '../services/recommendationRateLimit.service.js';
import { buildAiAnalysisPdf, type ExportRecommendation } from '../services/aiAnalysisReport.service.js';
import { HttpError } from '../utils/httpError.js';

function exportRecommendations(body: Record<string, unknown>): ExportRecommendation[] | null {
  if (!Array.isArray(body.recommendations)) return null;
  return body.recommendations
    .filter((item): item is Record<string, unknown> => Boolean(item) && typeof item === 'object')
    .map((item) => ({
      priority: typeof item.priority === 'string' ? item.priority : undefined,
      title: typeof item.title === 'string' ? item.title.slice(0, 200) : undefined,
      action: typeof item.action === 'string' ? item.action.slice(0, 600) : undefined,
      reason: typeof item.reason === 'string' ? item.reason.slice(0, 600) : undefined
    }))
    .slice(0, 4);
}

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
  const quota = await consumeRecommendationQuota(String(req.user._id));
  res.set({ 'X-RateLimit-Remaining': String(quota.remaining), 'X-Reset-At': quota.resetAt.toISOString() });
  const analysis = await analyseReviews(req.company, analysisInput(req.body));
  res.json({ recommendations: await buildRecommendations(String(req.company._id), analysis) });
}

export async function exportPdf(req: Request, res: Response) {
  const pdfBuffer = await buildAiAnalysisPdf(req.company, analysisInput(req.body), exportRecommendations(req.body));
  res.set({ 'Content-Type': 'application/pdf', 'Content-Disposition': `attachment; filename="analyse-ia-${req.company.slug}.pdf"` });
  res.send(pdfBuffer);
}

export async function topicReviews(req: Request, res: Response) {
  const input = {
    ...analysisInput(req.body),
    page: Number(req.query.page) || 1,
    limit: Number(req.query.limit) || 10
  };
  res.json(await getReviewsForTopic(req.company, String(req.params.topicKey), input));
}
