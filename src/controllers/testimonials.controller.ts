import type { Request, Response } from 'express';
import * as testimonialsService from '../services/testimonials.service.js';

export async function getPublicTestimonials(req: Request, res: Response) {
  const rawLimit = req.query.limit;
  const limit = typeof rawLimit === 'string' && rawLimit.trim() ? Number(rawLimit) : undefined;
  const data = await testimonialsService.getPublicTestimonials(String(req.params.slug), limit);
  res.json(data);
}
