import { Router } from 'express';
import * as qrCodeController from '../controllers/qrcode.controller.js';
import { requireAuth } from '../middleware/auth.js';
import { asyncHandler } from '../utils/asyncHandler.js';
import { createQrCodeValidator, updateQrCodeValidator } from '../validators/qrcode.validator.js';
import { handleValidation } from '../validators/validation.middleware.js';

const router = Router();

router.use(requireAuth);

router.get('/', asyncHandler(qrCodeController.listQrCodes));
router.post('/', createQrCodeValidator, handleValidation, asyncHandler(qrCodeController.createQrCode));
router.get('/:qrCodeId/download.png', asyncHandler(qrCodeController.downloadQrCodePng));
router.get('/:qrCodeId/download.pdf', asyncHandler(qrCodeController.downloadQrCodePdf));
router.patch('/:qrCodeId', updateQrCodeValidator, handleValidation, asyncHandler(qrCodeController.updateQrCode));
router.patch('/:qrCodeId/notifications', asyncHandler(qrCodeController.updateQrCodeNotifications));
router.delete('/:qrCodeId', asyncHandler(qrCodeController.disableQrCode));

export default router;
