import { Router } from 'express';
import * as dashboardController from '../controllers/dashboard.controller.js';
import { requireAuth } from '../middleware/auth.js';
import { asyncHandler } from '../utils/asyncHandler.js';

const router = Router();

router.use(requireAuth);

router.get('/reviews', asyncHandler(dashboardController.getReviews));
router.patch('/reviews/:reviewId/moderation', asyncHandler(dashboardController.updateReviewModeration));
router.get('/stats', asyncHandler(dashboardController.getStats));
router.get('/qr-trends', asyncHandler(dashboardController.getQrTrends));
router.get('/monthly-evolution', asyncHandler(dashboardController.getMonthlyEvolution));
router.get('/rating-distribution', asyncHandler(dashboardController.getRatingDistribution));
router.get('/feedback-form-config', asyncHandler(dashboardController.getFeedbackFormConfig));
router.patch('/feedback-form-config', asyncHandler(dashboardController.updateFeedbackFormConfig));
router.get('/notification-preferences', asyncHandler(dashboardController.getNotificationPreferences));
router.patch('/notification-preferences', asyncHandler(dashboardController.updateNotificationPreferences));
router.get('/ai/overview', asyncHandler(dashboardController.getAiOverview));
router.get('/ai/search', asyncHandler(dashboardController.searchAiReviews));
router.post('/ai/reindex', asyncHandler(dashboardController.reindexAiReviews));
router.get('/export.xlsx', asyncHandler(dashboardController.exportExcel));

export default router;
