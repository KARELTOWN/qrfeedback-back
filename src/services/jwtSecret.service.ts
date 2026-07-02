import { env } from '../config/env.js';
import { readFileSecret } from './fileSecret.service.js';
import { HttpError } from '../utils/httpError.js';

export async function getJwtSecret() {
  const fileSecret = await readFileSecret('jwtSecret');
  if (fileSecret) return fileSecret;
  if (env.jwtSecret) return env.jwtSecret;
  if (env.nodeEnv !== 'production') return 'dev-only-secret';

  throw new HttpError(500, 'JWT secret non configure.');
}
