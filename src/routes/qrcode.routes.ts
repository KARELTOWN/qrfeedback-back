import { Router } from 'express';
import * as qrCodeController from '../controllers/qrcode.controller.js';
import { requireAuth } from '../middleware/auth.js';
import { asyncHandler } from '../utils/asyncHandler.js';
import { createQrCodeValidator } from '../validators/qrcode.validator.js';
import { handleValidation } from '../validators/validation.middleware.js';

const router = Router();

router.use(requireAuth);

router.get('/', asyncHandler(qrCodeController.listQrCodes));
router.post('/', createQrCodeValidator, handleValidation, asyncHandler(qrCodeController.createQrCode));

export default router;
