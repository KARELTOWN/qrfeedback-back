import { app } from './app.js';
import { env } from './config/env.js';
import { connectDatabase } from './config/database.js';
import { startReminderScheduler } from './jobs/reminderScheduler.js';
import { seedSuperAdmin } from './services/seed.service.js';

await connectDatabase();
await seedSuperAdmin();
startReminderScheduler();

app.listen(env.port, () => {
  console.log(`QR Feedback API listening on port ${env.port}`);
});
