import mongoose from "mongoose";
import { env } from "../config/env.js";
import { Company } from "../models/Company.js";

async function main() {
  await mongoose.connect(env.mongoUri);
  const result = await Company.updateMany(
    { freeEmailNotificationsLimit: { $lt: 300 } },
    { $set: { freeEmailNotificationsLimit: 300 } },
  );
  console.log(`[migrate:email-free-quota] matched=${result.matchedCount} modified=${result.modifiedCount}`);
  await mongoose.disconnect();
}

main().catch(async (error) => {
  console.error(error);
  await mongoose.disconnect().catch(() => undefined);
  process.exit(1);
});
