import { Router } from 'express';
import * as whatsappWebhookController from '../controllers/whatsappWebhook.controller.js';
import { asyncHandler } from '../utils/asyncHandler.js';

const router = Router();

router.get('/', asyncHandler(whatsappWebhookController.verifyWebhook));
router.post('/', asyncHandler(whatsappWebhookController.handleWebhook));

export default router;
