import jwt from 'jsonwebtoken';
import type { NextFunction, Request, Response } from 'express';
import { env } from '../config/env.js';
import { User } from '../models/User.js';
import { HttpError } from '../utils/httpError.js';
import { getJwtSecret } from '../services/jwtSecret.service.js';

type JwtPayload = {
  sub: string;
  tokenVersion?: number;
};

export async function requireAuth(req: Request, res: Response, next: NextFunction) {
  try {
    const header = req.headers.authorization || '';
    const token = header.startsWith('Bearer ') ? header.slice(7) : null;
    if (!token) throw new HttpError(401, 'Authentification requise.');

    const payload = jwt.verify(token, await getJwtSecret()) as JwtPayload;
    const user = await User.findById(payload.sub).populate('company');
    if (!user) throw new HttpError(401, 'Session invalide.');
    if ((user.tokenVersion || 0) !== (payload.tokenVersion || 0)) throw new HttpError(401, 'Session invalide.');
    if (user.isActive === false) throw new HttpError(403, 'Compte desactive.');

    req.user = user;
    req.company = user.company as unknown as typeof req.company;
    next();
  } catch (error) {
    const status = error instanceof HttpError ? error.status : undefined;
    next(status ? error : new HttpError(401, 'Session invalide.'));
  }
}

export function requireSuperAdmin(req: Request, res: Response, next: NextFunction) {
  if (req.user?.roleId !== 'superadministrateur') {
    next(new HttpError(403, 'Acces superadministrateur requis.'));
    return;
  }

  next();
}
