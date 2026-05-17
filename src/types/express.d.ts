import type { HydratedDocument } from 'mongoose';
import type { ICompany } from '../models/Company.js';
import type { IUser } from '../models/User.js';

declare global {
  namespace Express {
    interface Request {
      user: HydratedDocument<IUser>;
      company: HydratedDocument<ICompany>;
    }
  }
}

export {};
