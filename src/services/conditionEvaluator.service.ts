function valueAtPath(source: unknown, path: string) {
  return path.split('.').reduce<unknown>((value, key) => {
    if (!value || typeof value !== 'object') return undefined;
    return (value as Record<string, unknown>)[key];
  }, source);
}

function normalizeComparable(value: unknown) {
  if (value instanceof Date) return value.getTime();
  if (typeof value === 'string') return value.trim();
  return value;
}

export type AutomationConditionInput = {
  field: string;
  operator: string;
  value?: unknown;
};

export function evaluateCondition(context: Record<string, unknown>, condition: AutomationConditionInput) {
  const actual = normalizeComparable(valueAtPath(context, condition.field));
  const expected = normalizeComparable(condition.value);

  if (condition.operator === 'exists') return actual !== undefined && actual !== null && actual !== '';
  if (condition.operator === 'not_exists') return actual === undefined || actual === null || actual === '';
  if (condition.operator === 'equals') return actual === expected;
  if (condition.operator === 'not_equals') return actual !== expected;
  if (condition.operator === 'contains') return String(actual || '').toLowerCase().includes(String(expected || '').toLowerCase());
  if (condition.operator === 'not_contains') return !String(actual || '').toLowerCase().includes(String(expected || '').toLowerCase());
  if (condition.operator === 'in') return (Array.isArray(expected) ? expected : [expected]).includes(actual);
  if (condition.operator === 'not_in') return !(Array.isArray(expected) ? expected : [expected]).includes(actual);

  const actualNumber = Number(actual);
  const expectedNumber = Number(expected);
  if (condition.operator === '<') return actualNumber < expectedNumber;
  if (condition.operator === '<=') return actualNumber <= expectedNumber;
  if (condition.operator === '>') return actualNumber > expectedNumber;
  if (condition.operator === '>=') return actualNumber >= expectedNumber;

  return false;
}

export function evaluateConditions(
  context: Record<string, unknown>,
  conditions: AutomationConditionInput[] = [],
  join: 'and' | 'or' = 'and'
) {
  if (!conditions.length) return true;
  const results = conditions.map((condition) => evaluateCondition(context, condition));
  return join === 'or' ? results.some(Boolean) : results.every(Boolean);
}
