import { body, param } from 'express-validator';

export const createQrCodeValidator = [
  body('whatsappNumber')
    .trim()
    .matches(/^\+\d{8,15}$/)
    .withMessage('Le numero WhatsApp doit etre au format international, ex: +2290199997478.'),
  body('label').optional({ values: 'falsy' }).trim().isLength({ max: 80 }).withMessage('Libelle trop long.')
];

export const qrCodeIdValidator = [
  param('id').isMongoId().withMessage('QR form invalide.')
];

export const upsertQrCodeListMappingValidator = [
  ...qrCodeIdValidator,
  body('listId').optional({ values: 'falsy' }).isMongoId().withMessage('Liste invalide.'),
  body('fieldMappings').optional().isArray().withMessage('Le mapping doit etre une liste.'),
  body('fieldMappings.*.formFieldKey').optional().isString().trim().notEmpty(),
  body('fieldMappings.*.formFieldLabel').optional({ values: 'falsy' }).isString().trim(),
  body('fieldMappings.*.listAttributeKey')
    .optional()
    .isString()
    .trim()
    .matches(/^[a-z][a-z0-9_]{1,63}$/)
    .withMessage('Attribut de liste invalide.'),
  body('fieldMappings.*.createIfMissing').optional().isBoolean(),
  body('autoCreateContact').optional().isBoolean(),
  body('autoAddToList').optional().isBoolean()
];
