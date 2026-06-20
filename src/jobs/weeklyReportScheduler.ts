import cron from "node-cron";
import type { HydratedDocument } from "mongoose";
import { User } from "../models/User.js";
import { Company } from "../models/Company.js";
import type { ICompany } from "../models/Company.js";
import { Review } from "../models/Review.js";
import { bot } from "../services/telegramBot.service.js";
import {
  buildWeeklyReportPdf,
  getLastWeekRange,
} from "../services/weeklyReport.service.js";

let isRunning = false;

export function startWeeklyReportScheduler() {
  cron.schedule("0 8 * * *", async () => {
    if (isRunning) return;
    isRunning = true;

    try {
      await sendWeeklyReports();
    } catch (error) {
      console.error("[weekly-report:scheduler:error]", error);
    } finally {
      isRunning = false;
    }
  });

  console.info("[weekly-report:scheduler:started]");
}

async function sendWeeklyReports() {
  if (!bot) {
    console.warn("[weekly-report:skip] Bot not initialized");
    return;
  }

  const weekRange = getLastWeekRange();

  const users = await User.find({
    "telegramProfile.isActive": true,
    "telegramProfile.chatId": { $exists: true, $ne: "" },
    "notificationPreferences.channels.telegram": true,
  }).lean();

  let sent = 0;
  let errors = 0;

  for (const user of users) {
    try {
      const chatId = user.telegramProfile?.chatId;
      if (!chatId || !user.company) continue;

      const reviewCount = await Review.countDocuments({
        company: user.company,
        createdAt: {
          $gte: new Date(weekRange.startDate),
          $lte: new Date(weekRange.endDate),
        },
      });

      if (reviewCount === 0) continue;

      const company = await Company.findById(user.company);
      if (!company) continue;

      const pdfBuffer = await buildWeeklyReportPdf(
        company as HydratedDocument<ICompany>,
        weekRange,
      );

      await bot.sendDocument(
        Number(chatId),
        pdfBuffer,
        {
          caption: `Bilan hebdomadaire du ${weekRange.startLabel} au ${weekRange.endLabel}`,
        },
        {
          filename: `bilan-hebdomadaire-${company.slug}.pdf`,
          contentType: "application/pdf",
        },
      );

      sent++;
    } catch (error) {
      console.error("[weekly-report:user-error]", { userId: user._id, error });
      errors++;
    }
  }

  console.info("[weekly-report:complete]", { sent, errors });
}
