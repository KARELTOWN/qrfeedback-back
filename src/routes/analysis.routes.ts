import { Router } from 'express';
import * as analysisController from '../controllers/analysis.controller.js';
import { requireAuth } from '../middleware/auth.js';
import { asyncHandler } from '../utils/asyncHandler.js';

const router = Router();
router.use(requireAuth);
router.post('/analyse', asyncHandler(analysisController.analyse));
router.post('/recommandations', asyncHandler(analysisController.recommendations));

export default router;
