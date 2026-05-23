import { app } from './app.js';
import { env } from './config/env.js';
import { connectDatabase } from './config/database.js';
import { startAutomationJobScheduler } from './jobs/automationJobScheduler.js';
import { startReminderScheduler } from './jobs/reminderScheduler.js';
import { seedSuperAdmin } from './services/seed.service.js';
import { appLogger } from './utils/appLogger.js';

await connectDatabase();
appLogger.info('server', 'database connected');
await seedSuperAdmin();
appLogger.info('server', 'seed completed');
startAutomationJobScheduler();
startReminderScheduler();
appLogger.info('server', 'schedulers started');

app.listen(env.port, () => {
  appLogger.info('server', `QR Feedback API listening on port ${env.port}`);
});
