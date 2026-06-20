import { Router } from 'express';
import * as paymentController from '../controllers/payment.controller.js';
import { asyncHandler } from '../utils/asyncHandler.js';

const router = Router();

router.post('/', asyncHandler(paymentController.createPayment));
router.post('/authenticated', asyncHandler(paymentController.createAuthenticatedPayment));
router.post('/:id/verify', asyncHandler(paymentController.verifyPaymentReturn));
router.post('/:id/confirm', asyncHandler(paymentController.confirmPayment));

export default router;
