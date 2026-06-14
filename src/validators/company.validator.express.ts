import { body, param } from 'express-validator';

export const registerCompanyValidator = [
  body('name').trim().isLength({ min: 2, max: 120 }).withMessage('Le nom de l’entreprise doit contenir entre 2 et 120 caractères.'),
  body('email').trim().isEmail().withMessage('Adresse email invalide.').normalizeEmail(),
  body('whatsappNumber')
    .optional({ values: 'falsy' })
    .trim()
    .matches(/^\+\d{8,15}$/)
    .withMessage('Le numéro WhatsApp doit être au format international, ex: +2290199997478.')
  ,
  body('turnstileToken').optional().isString().isLength({ max: 2048 }).withMessage('Verification anti-robot invalide.')
];

export const companySlugValidator = [
  param('slug').trim().isLength({ min: 3 }).withMessage('Lien entreprise invalide.')
];
