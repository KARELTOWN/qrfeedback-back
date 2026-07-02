import cron from "node-cron";
import { broadcastDueTelegramAds } from "../services/telegramAd.service.js";

let isRunning = false;

export function startTelegramAdScheduler() {
  cron.schedule("* * * * *", async () => {
    if (isRunning) return;
    isRunning = true;

    try {
      const results = await broadcastDueTelegramAds();
      if (results.length) {
        console.info("[telegram-ads:scheduler:sent]", { ads: results.length, results });
      }
    } catch (error) {
      console.error("[telegram-ads:scheduler:error]", error);
    } finally {
      isRunning = false;
    }
  });

  console.info("[telegram-ads:scheduler:started]");
}
