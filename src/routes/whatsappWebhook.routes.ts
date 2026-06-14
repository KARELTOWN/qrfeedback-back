import { Router } from 'express';
import * as whatsappWebhookController from '../controllers/whatsappWebhook.controller.js';
import { asyncHandler } from '../utils/asyncHandler.js';
import { whatsappStatusValidator } from '../validators/whatsappWebhook.validator.js';
import { handleValidation } from '../validators/validation.middleware.js';

const router = Router();

router.get('/', asyncHandler(whatsappWebhookController.verifyWebhook));
router.post('/status', whatsappStatusValidator, handleValidation, asyncHandler(whatsappWebhookController.handleStatus));
router.post('/', whatsappStatusValidator, handleValidation, asyncHandler(whatsappWebhookController.handleStatus));

export default router;
