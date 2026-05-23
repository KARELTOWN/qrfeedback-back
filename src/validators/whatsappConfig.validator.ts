import { body } from 'express-validator';

export const upsertWhatsappConfigValidator = [
  body('wabaId').isString().trim().notEmpty(),
  body('phoneNumberId').isString().trim().notEmpty(),
  body('accessToken').isString().trim().notEmpty(),
  body('businessAccountId').optional().isString().trim(),
  body('webhookVerifyToken').optional().isString().trim(),
  body('webhookSecret').optional().isString().trim(),
  body('displayPhoneNumber').optional().isString().trim(),
  body('status').optional().isIn(['pending', 'active', 'disabled', 'error'])
];

export const upsertWhatsappTemplateValidator = [
  body('name').isString().trim().notEmpty(),
  body('languageCode').optional().isString().trim(),
  body('category').optional().isIn(['marketing', 'utility', 'authentication', 'service', 'unknown']),
  body('status').optional().isIn(['draft', 'pending', 'approved', 'rejected', 'paused', 'disabled']),
  body('components').optional(),
  body('externalId').optional().isString().trim()
];

export const estimateWhatsappCostValidator = [
  body('messageType').optional().isIn(['text', 'template']),
  body('templateId').optional().isMongoId(),
  body('recipient').optional().isString().trim(),
  body('metadata').optional().isObject()
];

export const sendWhatsappTestValidator = [
  body('to').isString().trim().notEmpty(),
  body('templateName').optional().isString().trim(),
  body('languageCode').optional().isString().trim()
];
