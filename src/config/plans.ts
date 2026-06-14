export const plans = [
  { code: 'unlimited_7500', label: 'Acces illimite QrFeedback', whatsappMessages: 0, emailNotifications: 0, messages: 0, priceFcfa: 7500, unlimited: true }
];

export function findPlan(code: string) {
  return plans.find((plan) => plan.code === code);
}
