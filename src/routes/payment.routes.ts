import { Router } from 'express';
import * as paymentController from '../controllers/payment.controller.js';
import { requireAuth } from '../middleware/auth.js';
import { asyncHandler } from '../utils/asyncHandler.js';
import {
  confirmPaymentValidator,
  createAuthenticatedPaymentValidator,
  createPaymentValidator,
  verifyPaymentReturnValidator
} from '../validators/payment.validator.js';
import { handleValidation } from '../validators/validation.middleware.js';

const router = Router();

router.post('/', createPaymentValidator, handleValidation, asyncHandler(paymentController.createPayment));
router.post('/authenticated', requireAuth, createAuthenticatedPaymentValidator, handleValidation, asyncHandler(paymentController.createAuthenticatedPayment));
router.post('/moneroo/webhook', asyncHandler(paymentController.monerooWebhook));
router.post('/:id/verify', verifyPaymentReturnValidator, handleValidation, asyncHandler(paymentController.verifyPaymentReturn));
router.post('/:id/confirm', confirmPaymentValidator, handleValidation, asyncHandler(paymentController.confirmPayment));

export default router;
