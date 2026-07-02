import { z } from 'zod';

export const registerCompanySchema = z.object({
  name: z.string().min(2).max(120),
  email: z.string().email(),
  turnstileToken: z.string().max(2048).optional()
});
