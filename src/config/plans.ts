export const plans = [
  {
    code: 'free_unlimited',
    label: 'Opinbase gratuit',
    emailNotifications: 0,
    messages: 0,
    priceFcfa: 0,
    unlimited: true
  }
];

export function findPlan(code: string) {
  return plans.find((plan) => plan.code === code);
}
