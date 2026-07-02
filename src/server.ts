import { app } from "./app.js";
import { env } from "./config/env.js";
import { connectDatabase } from "./config/database.js";
import { seedSuperAdmin } from "./services/seed.service.js";
import { initializeTelegramBot } from "./services/telegramBot.service.js";

await connectDatabase();
await seedSuperAdmin();
await initializeTelegramBot();

app.listen(env.port, () => {
  console.log(`QR Feedback API listening on port ${env.port}`);
});
