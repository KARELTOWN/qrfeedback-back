import { Router } from 'express';
import * as inboxController from '../controllers/inbox.controller.js';
import { requireAuth } from '../middleware/auth.js';
import { asyncHandler } from '../utils/asyncHandler.js';

const router = Router();

router.use(asyncHandler(requireAuth));
router.get('/conversations', asyncHandler(inboxController.listConversations));
router.get('/conversations/:id/messages', asyncHandler(inboxController.getMessages));
router.post('/conversations/:id/messages', asyncHandler(inboxController.sendMessage));

export default router;
