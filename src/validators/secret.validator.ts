import { body, param } from 'express-validator';
import { secretNames } from '../models/EncryptedSecret.js';

export const upsertSecretValidator = [
  param('name').isIn(secretNames).withMessage('Nom de clé sensible invalide.'),
  body('value')
    .isString()
    .trim()
    .isLength({ min: 8, max: 4096 })
    .withMessage('La valeur doit contenir entre 8 et 4096 caractères.')
];
