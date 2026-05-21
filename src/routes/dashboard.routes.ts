import { Router } from 'express';
import * as dashboardController from '../controllers/dashboard.controller.js';
import { requireAuth } from '../middleware/auth.js';
import { asyncHandler } from '../utils/asyncHandler.js';

const router = Router();

router.use(requireAuth);

router.get('/reviews', asyncHandler(dashboardController.getReviews));
router.get('/stats', asyncHandler(dashboardController.getStats));
router.get('/monthly-evolution', asyncHandler(dashboardController.getMonthlyEvolution));
router.get('/rating-distribution', asyncHandler(dashboardController.getRatingDistribution));
router.get('/feedback-form-config', asyncHandler(dashboardController.getFeedbackFormConfig));
router.patch('/feedback-form-config', asyncHandler(dashboardController.updateFeedbackFormConfig));
router.get('/export.xlsx', asyncHandler(dashboardController.exportExcel));

export default router;
