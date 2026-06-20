import { body, param } from 'express-validator';

export const registerCompanyValidator = [
  body('name')
    .trim()
    .isLength({ min: 2, max: 120 })
    .withMessage("Le nom de l'entreprise doit contenir entre 2 et 120 caracteres."),
  body('email').trim().isEmail().withMessage('Adresse email invalide.').normalizeEmail(),
  body('turnstileToken')
    .optional()
    .isString()
    .isLength({ max: 2048 })
    .withMessage('Verification anti-robot invalide.')
];

export const companySlugValidator = [
  param('slug').trim().isLength({ min: 3 }).withMessage('Lien entreprise invalide.')
];
