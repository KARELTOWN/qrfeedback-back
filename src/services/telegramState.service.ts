import { redisConnection } from "../queues/connection.js";

const PREFIX = "qr-feedback:telegram-state:";

export async function putTelegramState(key: string, value: unknown, ttlSeconds: number) {
  await redisConnection.set(`${PREFIX}${key}`, JSON.stringify(value), "EX", ttlSeconds);
}

export async function getTelegramState<T>(key: string): Promise<T | null> {
  const raw = await redisConnection.get(`${PREFIX}${key}`);
  if (!raw) return null;
  try { return JSON.parse(raw) as T; } catch { await redisConnection.del(`${PREFIX}${key}`); return null; }
}

export async function deleteTelegramState(key: string) {
  await redisConnection.del(`${PREFIX}${key}`);
}
