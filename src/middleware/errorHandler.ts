import type { NextFunction, Request, Response } from 'express';
import { logger } from '../utils/logger.js';

type ErrorWithStatus = Error & {
  status?: number;
  errors?: unknown;
  headers?: Record<string, string>;
};

export function errorHandler(error: ErrorWithStatus, req: Request, res: Response, next: NextFunction) {
  if (error?.name === 'ZodError') {
    return res.status(400).json({
      message: 'Donnees invalides.',
      issues: error.errors
    });
  }

  const status = error.status || 500;
  if (error.headers) res.set(error.headers);
  if (status >= 500) {
    logger.error('request:error', {
      error,
      method: req.method,
      path: req.path,
      status
    });
  }

  res.status(status).json({
    message: error.message || 'Une erreur est survenue.'
  });
}
