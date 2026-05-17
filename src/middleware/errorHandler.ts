import type { NextFunction, Request, Response } from 'express';

type ErrorWithStatus = Error & {
  status?: number;
  errors?: unknown;
};

export function errorHandler(error: ErrorWithStatus, req: Request, res: Response, next: NextFunction) {
  if (error?.name === 'ZodError') {
    return res.status(400).json({
      message: 'Données invalides.',
      issues: error.errors
    });
  }

  const status = error.status || 500;
  if (status >= 500) {
    console.error(error);
  }

  res.status(status).json({
    message: error.message || 'Une erreur est survenue.'
  });
}
