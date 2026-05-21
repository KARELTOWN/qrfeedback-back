import type { Request, Response } from 'express';
import * as dashboardService from '../services/dashboard.service.js';

export async function getReviews(req: Request, res: Response) {
  const reviews = await dashboardService.getCompanyReviews(req.company, {
    page: Number(req.query.page),
    limit: Number(req.query.limit)
  });
  res.json(reviews);
}

export async function getStats(req: Request, res: Response) {
  const stats = await dashboardService.getCompanyStats(req.company);
  res.json(stats);
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
