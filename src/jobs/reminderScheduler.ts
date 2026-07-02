export function startReminderScheduler() {
  console.info("[reminder:scheduler:disabled] Payment reminders are disabled for the free plan.");
}

export async function processDueReminders(now = new Date()) {
  void now;
}
