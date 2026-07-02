import { Router } from 'express';
import * as adminController from '../controllers/admin.controller.js';
import * as telegramAdController from '../controllers/telegramAd.controller.js';
import * as notificationTemplateController from '../controllers/notificationTemplate.controller.js';
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
import { createNotificationTemplateValidator, notificationTemplateNameValidator, previewNotificationTemplateValidator, updateNotificationTemplateValidator } from '../validators/notificationTemplate.validator.js';

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
router.get('/notification-templates', asyncHandler(notificationTemplateController.list));
router.post('/notification-templates', createNotificationTemplateValidator, handleValidation, asyncHandler(notificationTemplateController.create));
router.get('/notification-templates/:name', notificationTemplateNameValidator, handleValidation, asyncHandler(notificationTemplateController.get));
router.patch('/notification-templates/:name', updateNotificationTemplateValidator, handleValidation, asyncHandler(notificationTemplateController.update));
router.post('/notification-templates/:name/preview', previewNotificationTemplateValidator, handleValidation, asyncHandler(notificationTemplateController.preview));

export default router;
