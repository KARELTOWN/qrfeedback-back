export const plans = [
  { code: 'starter_100', label: '100 messages', messages: 100, priceFcfa: 5000 },
  { code: 'growth_500', label: '500 messages', messages: 500, priceFcfa: 25000 },
  { code: 'pro_1000', label: '1000 messages', messages: 1000, priceFcfa: 40000 }
];

export function findPlan(code: string) {
  return plans.find((plan) => plan.code === code);
}
