import { Router } from 'express';
import * as segmentController from '../controllers/segment.controller.js';
import { requireAuth } from '../middleware/auth.js';
import { asyncHandler } from '../utils/asyncHandler.js';
import { handleValidation } from '../validators/validation.middleware.js';
import {
  createSegmentValidator,
  segmentConditionValidator,
  segmentIdValidator,
  updateSegmentValidator
} from '../validators/segment.validator.js';

const router = Router();

router.use(requireAuth);

router.get('/', asyncHandler(segmentController.listSegments));
router.get('/templates', asyncHandler(segmentController.listTemplates));
router.post('/contacts/filter', segmentConditionValidator, handleValidation, asyncHandler(segmentController.filterContacts));
router.post('/preview', segmentConditionValidator, handleValidation, asyncHandler(segmentController.previewSegment));
router.post('/', createSegmentValidator, handleValidation, asyncHandler(segmentController.createSegment));
router.get('/:id', segmentIdValidator, handleValidation, asyncHandler(segmentController.getSegment));
router.patch('/:id', updateSegmentValidator, handleValidation, asyncHandler(segmentController.updateSegment));
router.delete('/:id', segmentIdValidator, handleValidation, asyncHandler(segmentController.archiveSegment));
router.post('/:id/recalculate', segmentIdValidator, handleValidation, asyncHandler(segmentController.recalculateSegment));
router.get('/:id/members', segmentIdValidator, handleValidation, asyncHandler(segmentController.listSegmentMembers));

export default router;
