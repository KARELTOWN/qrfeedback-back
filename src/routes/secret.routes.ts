import { Router } from 'express';
import * as secretController from '../controllers/secret.controller.js';
import { requireAuth } from '../middleware/auth.js';
import { asyncHandler } from '../utils/asyncHandler.js';
import { upsertSecretValidator } from '../validators/secret.validator.js';
import { handleValidation } from '../validators/validation.middleware.js';

const router = Router();

router.use(requireAuth);

router.get('/', asyncHandler(secretController.listSecrets));
router.put('/:name', upsertSecretValidator, handleValidation, asyncHandler(secretController.upsertSecret));

export default router;
