import { z } from 'zod';

export const reviewSchema = z.object({
  serviceFeedback: z.string().max(2000).optional().or(z.literal('')),
  rating: z.number().int().min(1).max(5)
});
