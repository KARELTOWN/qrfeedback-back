import { Router } from 'express';
import * as adminController from '../controllers/admin.controller.js';
import * as telegramAdController from '../controllers/telegramAd.controller.js';
import { requireAuth, requireSuperAdmin } from '../middleware/auth.js';
import { asyncHandler } from '../utils/asyncHandler.js';
import { setUserActiveValidator, userIdValidator } from '../validators/admin.validator.js';
import {
  createTelegramAdValidator,
  setTelegramAdActiveValidator,
  telegramAdIdValidator,
  updateTelegramAdValidator
} from '../validators/telegramAd.validator.js';
import { handleValidation } from '../validators/validation.middleware.js';

const router = Router();

router.use(requireAuth, requireSuperAdmin);

router.get('/stats', asyncHandler(adminController.getStats));
router.get('/users', asyncHandler(adminController.listUsers));
router.get('/users/:userId', userIdValidator, handleValidation, asyncHandler(adminController.getUserDetails));
router.post('/users/:userId/generate-password', userIdValidator, handleValidation, asyncHandler(adminController.generatePassword));
router.patch('/users/:userId/active', setUserActiveValidator, handleValidation, asyncHandler(adminController.setUserActive));
router.get('/qr-requests/no-account', asyncHandler(adminController.listQrRequestsWithoutAccount));
router.get('/transactions', asyncHandler(adminController.listTransactions));
router.get('/inactive-users', asyncHandler(adminController.listInactiveUsers));
router.get('/telegram-ads', asyncHandler(telegramAdController.listTelegramAds));
router.post('/telegram-ads', createTelegramAdValidator, handleValidation, asyncHandler(telegramAdController.createTelegramAd));
router.get('/telegram-ads/:adId', telegramAdIdValidator, handleValidation, asyncHandler(telegramAdController.getTelegramAd));
router.patch('/telegram-ads/:adId', updateTelegramAdValidator, handleValidation, asyncHandler(telegramAdController.updateTelegramAd));
router.patch('/telegram-ads/:adId/active', setTelegramAdActiveValidator, handleValidation, asyncHandler(telegramAdController.setTelegramAdActive));
router.post('/telegram-ads/:adId/publish', telegramAdIdValidator, handleValidation, asyncHandler(telegramAdController.publishTelegramAd));

export default router;
