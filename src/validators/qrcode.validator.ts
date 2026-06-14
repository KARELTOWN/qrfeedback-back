import { body } from 'express-validator';

export const createQrCodeValidator = [
  body('whatsappNumber')
    .optional({ values: 'falsy' })
    .trim()
    .matches(/^\+\d{8,15}$/)
    .withMessage('Le numéro WhatsApp doit être au format international, ex: +2290199997478.'),
  body('label').optional({ values: 'falsy' }).trim().isLength({ max: 80 }).withMessage('Libellé trop long.')
];
