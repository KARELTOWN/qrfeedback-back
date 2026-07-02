import { Router } from 'express';
import rateLimit from 'express-rate-limit';
import * as authController from '../controllers/auth.controller.js';
import { env } from '../config/env.js';
import { requireAuth } from '../middleware/auth.js';
import { asyncHandler } from '../utils/asyncHandler.js';
import {
  changePasswordValidator,
  forgotPasswordValidator,
  loginValidator,
  resendOtpValidator,
  resetPasswordValidator,
  signupValidator,
  verifyOtpValidator
} from '../validators/auth.validator.js';
import { handleValidation } from '../validators/validation.middleware.js';

const router = Router();

const otpRequestLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: env.otpRequestLimit,
  skipFailedRequests: true,
  standardHeaders: true,
  legacyHeaders: false,
  message: {
    message: 'Trop de demandes de code OTP. Réessayez dans 15 minutes.'
  }
});

router.post('/signup', otpRequestLimiter, signupValidator, handleValidation, asyncHandler(authController.signup));
router.post('/login', loginValidator, handleValidation, asyncHandler(authController.login));
router.post('/verify-otp', verifyOtpValidator, handleValidation, asyncHandler(authController.verifyOtp));
router.post('/resend-otp', otpRequestLimiter, resendOtpValidator, handleValidation, asyncHandler(authController.resendOtp));
router.post('/change-password', requireAuth, changePasswordValidator, handleValidation, asyncHandler(authController.changePassword));
router.post('/forgot-password', otpRequestLimiter, forgotPasswordValidator, handleValidation, asyncHandler(authController.forgotPassword));
router.post('/reset-password', resetPasswordValidator, handleValidation, asyncHandler(authController.resetPassword));

export default router;
