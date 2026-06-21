import { Router } from 'express';
import * as analysisController from '../controllers/analysis.controller.js';
import { requireAuth } from '../middleware/auth.js';
import { asyncHandler } from '../utils/asyncHandler.js';

const router = Router();
router.use(requireAuth);
router.post('/analyse', asyncHandler(analysisController.analyse));
router.post('/recommandations', asyncHandler(analysisController.recommendations));
router.post('/analyse/export.pdf', asyncHandler(analysisController.exportPdf));
router.post('/analyse/topics/:topicKey', asyncHandler(analysisController.topicReviews));

export default router;
