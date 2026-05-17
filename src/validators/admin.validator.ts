import { body, param } from 'express-validator';

export const userIdValidator = [
  param('userId').isMongoId().withMessage('Utilisateur invalide.')
];

export const setUserActiveValidator = [
  ...userIdValidator,
  body('isActive').isBoolean().withMessage('Statut invalide.')
];
