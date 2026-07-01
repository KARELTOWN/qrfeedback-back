import mongoose from 'mongoose';
import { env } from '../config/env.js';
import { Review } from '../models/Review.js';

async function main() {
  await mongoose.connect(env.mongoUri);

  const result = await Review.updateMany(
    { moderationStatus: { $exists: false } },
    { $set: { moderationStatus: 'published' } },
  );

  console.log(`[migrate:reviews-moderation-status] matched=${result.matchedCount} modified=${result.modifiedCount}`);
  await mongoose.disconnect();
}

main().catch(async (error) => {
  console.error(error);
  await mongoose.disconnect().catch(() => undefined);
  process.exit(1);
});
