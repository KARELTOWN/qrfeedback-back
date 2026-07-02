import { Router } from 'express';
import rateLimit from 'express-rate-limit';
import * as reviewController from '../controllers/review.controller.js';
import { asyncHandler } from '../utils/asyncHandler.js';
import { createReviewValidator } from '../validators/review.validator.express.js';
import { handleValidation } from '../validators/validation.middleware.js';

const router = Router();

const reviewLimiter = rateLimit({
  windowMs: 10 * 60 * 1000,
  max: 8,
  standardHeaders: true,
  legacyHeaders: false
});

router.post('/:slug', reviewLimiter, createReviewValidator, handleValidation, asyncHandler(reviewController.createReview));

export default router;
