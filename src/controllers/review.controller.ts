import type { Request, Response } from 'express';
import * as reviewService from '../services/review.service.js';
import { verifyTurnstileToken } from '../services/turnstile.service.js';

export async function createReview(req: Request, res: Response) {
  await verifyTurnstileToken(req.body.turnstileToken, req.ip);
  const review = await reviewService.createReviewForCompany(String(req.params.slug), req.body);
  res.status(201).json({ id: review._id, notificationStatus: review.notificationStatus });
}
