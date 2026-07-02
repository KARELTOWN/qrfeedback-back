import { body, param } from 'express-validator';

export const createPaymentValidator = [
  body('companySlug').optional().trim().isLength({ min: 3 }).withMessage('Entreprise invalide.'),
  body('planCode').trim().notEmpty().withMessage('Forfait requis.'),
  body('email').optional({ values: 'falsy' }).trim().isEmail().withMessage('Adresse email invalide.').normalizeEmail()
];

export const createAuthenticatedPaymentValidator = [
  body('planCode').trim().notEmpty().withMessage('Forfait requis.')
];

export const confirmPaymentValidator = [
  param('id').isMongoId().withMessage('Paiement invalide.')
];

export const verifyPaymentReturnValidator = [
  param('id').trim().notEmpty().withMessage('Paiement invalide.')
];
