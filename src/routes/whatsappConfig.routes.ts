import { Router } from 'express';
import * as whatsappConfigController from '../controllers/whatsappConfig.controller.js';
import { requireAuth } from '../middleware/auth.js';
import { asyncHandler } from '../utils/asyncHandler.js';
import { handleValidation } from '../validators/validation.middleware.js';
import {
  estimateWhatsappCostValidator,
  sendWhatsappTestValidator,
  upsertWhatsappConfigValidator,
  upsertWhatsappTemplateValidator
} from '../validators/whatsappConfig.validator.js';

const router = Router();

router.use(asyncHandler(requireAuth));
router.get('/config', asyncHandler(whatsappConfigController.getConfig));
router.put('/config', upsertWhatsappConfigValidator, handleValidation, asyncHandler(whatsappConfigController.upsertConfig));
router.get('/templates', asyncHandler(whatsappConfigController.listTemplates));
router.post('/templates', upsertWhatsappTemplateValidator, handleValidation, asyncHandler(whatsappConfigController.upsertTemplate));
router.delete('/templates/:id', asyncHandler(whatsappConfigController.deleteTemplate));
router.post('/estimate', estimateWhatsappCostValidator, handleValidation, asyncHandler(whatsappConfigController.estimateCost));
router.post('/test-message', sendWhatsappTestValidator, handleValidation, asyncHandler(whatsappConfigController.sendTestMessage));

export default router;
