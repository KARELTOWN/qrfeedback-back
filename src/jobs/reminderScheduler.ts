import cron from 'node-cron';
import { Company } from '../models/Company.js';
import { sendWhatsapp } from '../services/whatsapp.service.js';

export function startReminderScheduler() {
  cron.schedule('*/30 * * * *', () => {
    processDueReminders().catch((error) => console.error('Reminder scheduler error', error));
  });
}

export async function processDueReminders(now = new Date()) {
  const companies = await Company.find({
    paidMessagesBalance: { $lte: 0 },
    reminderSchedule: {
      $elemMatch: {
        dueAt: { $lte: now },
        sentAt: { $exists: false }
      }
    }
  });

  for (const company of companies) {
    if (!company.whatsappNumber) continue;

    for (const reminder of company.reminderSchedule) {
      if (!reminder.sentAt && reminder.dueAt <= now) {
        await sendWhatsapp({
          company,
          to: company.whatsappNumber,
          body: `Votre forfait gratuit QR Feedback est épuisé. Connectez-vous pour acheter un forfait et continuer à recevoir vos avis WhatsApp: ${company.feedbackUrl.replace('/avis/', '/paiement/')}`
        });
        reminder.sentAt = new Date();
      }
    }
    await company.save();
  }
}
