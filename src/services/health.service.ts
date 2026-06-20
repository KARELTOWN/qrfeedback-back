import mongoose from 'mongoose';
import { checkMailHealth } from './mail.service.js';
import { checkTypesenseHealth } from './typesense.service.js';

async function check(name: string, fn: () => Promise<unknown>) {
  try {
    const details = await fn();
    return { name, ok: true, details };
  } catch (error) {
    return {
      name,
      ok: false,
      error: error instanceof Error ? error.message : 'Unknown error'
    };
  }
}

export async function getHealthStatus() {
  const checks = await Promise.all([
    check('mongodb', async () => ({ readyState: mongoose.connection.readyState })),
    check('smtp', checkMailHealth),
    check('typesense', checkTypesenseHealth)
  ]);

  return {
    ok: checks.every((item) => item.ok),
    checks,
    generatedAt: new Date().toISOString()
  };
}
