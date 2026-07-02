import { body } from 'express-validator';

export const createQrCodeValidator = [
  body('label')
    .optional({ values: 'falsy' })
    .trim()
    .isLength({ max: 80 })
    .withMessage('Libelle trop long.')
];

export const updateQrCodeValidator = [
  body('label')
    .optional({ values: 'falsy' })
    .trim()
    .isLength({ max: 80 })
    .withMessage('Libelle trop long.'),
  body('isActive')
    .optional()
    .isBoolean()
    .withMessage('Statut actif invalide.')
    .toBoolean()
];
