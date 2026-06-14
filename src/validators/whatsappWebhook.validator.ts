import { body } from 'express-validator';

export const whatsappStatusValidator = [
  body('entry').optional().isArray(),
];
