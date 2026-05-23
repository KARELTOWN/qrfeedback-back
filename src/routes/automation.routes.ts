import { Router } from 'express';
import * as automationController from '../controllers/automation.controller.js';
import { requireAuth } from '../middleware/auth.js';
import { asyncHandler } from '../utils/asyncHandler.js';

const router = Router();

router.use(asyncHandler(requireAuth));
router.get('/', asyncHandler(automationController.listAutomations));
router.post('/', asyncHandler(automationController.createAutomation));
router.get('/:id', asyncHandler(automationController.getAutomation));
router.patch('/:id', asyncHandler(automationController.updateAutomation));
router.post('/:id/publish', asyncHandler(automationController.publishAutomation));
router.post('/:id/pause', asyncHandler(automationController.pauseAutomation));
router.post('/:id/test', asyncHandler(automationController.testAutomation));
router.delete('/:id', asyncHandler(automationController.deleteAutomation));
router.get('/:id/executions', asyncHandler(automationController.listExecutions));
router.get('/executions/:id/logs', asyncHandler(automationController.listLogs));

export default router;
