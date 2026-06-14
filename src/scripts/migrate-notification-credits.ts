import { connectDatabase } from '../config/database.js';
import { Company } from '../models/Company.js';
import mongoose from 'mongoose';

await connectDatabase();

const [limitsResult, usedResult, paidResult] = await Promise.all([
  Company.updateMany({}, { $max: { freeMessagesLimit: 50, freeEmailNotificationsLimit: 50 } }),
  Company.updateMany({ freeEmailNotificationsUsed: { $exists: false } }, { $set: { freeEmailNotificationsUsed: 0 } }),
  Company.updateMany({ paidEmailNotificationsBalance: { $exists: false } }, { $set: { paidEmailNotificationsBalance: 0 } })
]);

console.log(`Notification credits migrated. limits=${limitsResult.modifiedCount}, used=${usedResult.modifiedCount}, paid=${paidResult.modifiedCount}`);
await mongoose.disconnect();
process.exit(0);
