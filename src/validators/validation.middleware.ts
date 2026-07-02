import type { NextFunction, Request, Response } from 'express';
import { validationResult } from 'express-validator';

export function handleValidation(req: Request, res: Response, next: NextFunction) {
  const result = validationResult(req);
  if (result.isEmpty()) {
    next();
    return;
  }

  res.status(400).json({
    message: 'Données invalides.',
    errors: result.mapped()
  });
}
