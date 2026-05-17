import { Router } from 'express';
import * as adminController from '../controllers/admin.controller.js';
import { requireAuth, requireSuperAdmin } from '../middleware/auth.js';
import { asyncHandler } from '../utils/asyncHandler.js';
import { setUserActiveValidator, userIdValidator } from '../validators/admin.validator.js';
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

export default router;
