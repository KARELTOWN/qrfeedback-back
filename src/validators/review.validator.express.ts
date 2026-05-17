import { body, param } from 'express-validator';

export const createReviewValidator = [
  param('slug').trim().isLength({ min: 3 }).withMessage('Lien entreprise invalide.'),
  body('customerName').optional({ values: 'falsy' }).trim().isLength({ max: 120 }).withMessage('Nom trop long.'),
  body('customerPhone').optional({ values: 'falsy' }).trim().isLength({ max: 30 }).withMessage('Téléphone trop long.'),
  body('serviceFeedback').optional({ values: 'falsy' }).trim().isLength({ max: 2000 }).withMessage('Avis trop long.'),
  body('improvementSuggestion').optional({ values: 'falsy' }).trim().isLength({ max: 2000 }).withMessage('Suggestion trop longue.'),
  body('badExperience').optional({ values: 'falsy' }).trim().isLength({ max: 2000 }).withMessage('Message trop long.'),
  body('rating').isInt({ min: 1, max: 5 }).withMessage('La note doit être comprise entre 1 et 5.').toInt()
];
