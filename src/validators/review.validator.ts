import { z } from 'zod';

export const reviewSchema = z.object({
  customerName: z.string().max(120).optional().or(z.literal('')),
  customerPhone: z.string().max(30).optional().or(z.literal('')),
  serviceFeedback: z.string().max(2000).optional().or(z.literal('')),
  improvementSuggestion: z.string().max(2000).optional().or(z.literal('')),
  badExperience: z.string().max(2000).optional().or(z.literal('')),
  rating: z.number().int().min(1).max(5)
});
