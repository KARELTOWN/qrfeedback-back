import type { Request, Response } from 'express';
import * as reviewService from '../services/review.service.js';

export async function createReview(req: Request, res: Response) {
  const review = await reviewService.createReviewForCompany(String(req.params.slug), req.body);
  res.status(201).json({ id: review._id, notificationStatus: review.notificationStatus });
}
