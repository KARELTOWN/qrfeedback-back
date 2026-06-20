import { body, param } from 'express-validator';

export const createReviewValidator = [
  param('slug').trim().isLength({ min: 3 }).withMessage('Lien entreprise invalide.'),
  body('serviceFeedback').optional({ values: 'falsy' }).trim().isLength({ max: 2000 }).withMessage('Avis trop long.'),
  body('customAnswers').optional().isArray({ max: 8 }).withMessage('Questions personnalisees invalides.'),
  body('customAnswers.*.questionId').optional().trim().isLength({ max: 80 }).withMessage('Question invalide.'),
  body('turnstileToken').optional().isString().isLength({ max: 2048 }).withMessage('Verification anti-robot invalide.'),
  body('rating').isInt({ min: 1, max: 5 }).withMessage('La note doit etre comprise entre 1 et 5.').toInt()
];
