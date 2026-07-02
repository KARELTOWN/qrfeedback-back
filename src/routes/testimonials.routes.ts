import { Router } from 'express';
import rateLimit from 'express-rate-limit';
import * as testimonialsController from '../controllers/testimonials.controller.js';
import { asyncHandler } from '../utils/asyncHandler.js';

const router = Router();

const testimonialsLimiter = rateLimit({
  windowMs: 10 * 60 * 1000,
  max: 60,
  standardHeaders: true,
  legacyHeaders: false
});

router.get('/:slug', testimonialsLimiter, asyncHandler(testimonialsController.getPublicTestimonials));

export default router;
