import net from 'node:net';
import { env } from '../config/env.js';
import { HttpError } from '../utils/httpError.js';

const WEEKLY_RECOMMENDATION_LIMIT = Math.max(1, env.weeklyRecommendationLimit);

type IsoWeekWindow = { isoWeek: string; resetAt: Date };

function zonedParts(date: Date, timeZone: string) {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone,
    year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23'
  }).formatToParts(date);
  const read = (type: string) => Number(parts.find((part) => part.type === type)?.value);
  return { year: read('year'), month: read('month'), day: read('day'), hour: read('hour'), minute: read('minute'), second: read('second') };
}

function zonedMidnightToUtc(year: number, month: number, day: number, timeZone: string) {
  const guess = new Date(Date.UTC(year, month - 1, day));
  const actual = zonedParts(guess, timeZone);
  const desiredUtc = Date.UTC(year, month - 1, day);
  const actualAsUtc = Date.UTC(actual.year, actual.month - 1, actual.day, actual.hour, actual.minute, actual.second);
  return new Date(guess.getTime() - (actualAsUtc - desiredUtc));
}

/** ISO week and next Monday 00:00 in the configured business timezone. */
export function getIsoWeekWindow(now = new Date(), timeZone = env.rateLimitTimeZone): IsoWeekWindow {
  const local = zonedParts(now, timeZone);
  const localDay = new Date(Date.UTC(local.year, local.month - 1, local.day));
  const day = localDay.getUTCDay() || 7;
  const thursday = new Date(localDay);
  thursday.setUTCDate(thursday.getUTCDate() + 4 - day);
  const isoYear = thursday.getUTCFullYear();
  const firstThursday = new Date(Date.UTC(isoYear, 0, 4));
  const firstThursdayDay = firstThursday.getUTCDay() || 7;
  firstThursday.setUTCDate(firstThursday.getUTCDate() + 4 - firstThursdayDay);
  const isoWeek = 1 + Math.round((thursday.getTime() - firstThursday.getTime()) / 604800000);

  const nextMonday = new Date(localDay);
  nextMonday.setUTCDate(nextMonday.getUTCDate() + (8 - day));
  return {
    isoWeek: `${isoYear}-${String(isoWeek).padStart(2, '0')}`,
    resetAt: zonedMidnightToUtc(nextMonday.getUTCFullYear(), nextMonday.getUTCMonth() + 1, nextMonday.getUTCDate(), timeZone)
  };
}

function encodeRedisCommand(parts: string[]) {
  return `*${parts.length}\r\n${parts.map((part) => `$${Buffer.byteLength(part)}\r\n${part}\r\n`).join('')}`;
}

function parseRedisIntegerArray(value: string) {
  const matches = [...value.matchAll(/:([-]?\d+)\r\n/g)].map((match) => Number(match[1]));
  if (value.startsWith('-')) throw new Error(value.slice(1).trim());
  if (matches.length < 2) throw new Error('Unexpected Redis response.');
  return matches;
}

async function executeRedisLua(key: string, resetAt: Date) {
  const target = new URL(env.redisUrl);
  const script = "local count=redis.call('INCR',KEYS[1]); if count==1 then redis.call('EXPIREAT',KEYS[1],ARGV[1]); end; return {count,redis.call('TTL',KEYS[1])}";
  const command = encodeRedisCommand(['EVAL', script, '1', key, String(Math.floor(resetAt.getTime() / 1000))]);

  return await new Promise<number[]>((resolve, reject) => {
    const socket = net.createConnection({ host: target.hostname, port: Number(target.port || 6379) });
    let response = '';
    let settled = false;
    const finish = (callback: () => void) => {
      if (settled) return;
      settled = true;
      clearTimeout(timeout);
      socket.end();
      callback();
    };
    const timeout = setTimeout(() => socket.destroy(new Error('Redis timeout.')), 2000);
    socket.on('connect', () => socket.write(command));
    socket.on('data', (chunk) => {
      response += chunk.toString();
      try {
        const result = parseRedisIntegerArray(response);
        finish(() => resolve(result));
      } catch {
        // A TCP chunk can contain only part of the RESP response; wait for more.
      }
    });
    socket.on('end', () => {
      if (settled) return;
      finish(() => {
        try { resolve(parseRedisIntegerArray(response)); } catch (error) { reject(error); }
      });
    });
    socket.on('error', (error) => finish(() => reject(error)));
  });
}

export async function consumeRecommendationQuota(userId: string) {
  const { isoWeek, resetAt } = getIsoWeekWindow();
  const key = `reco:${userId}:week:${isoWeek}`;
  let count: number;
  try {
    [count] = await executeRedisLua(key, resetAt);
  } catch (error) {
    console.error('[recommendations:rate-limit:redis-error]', { error: error instanceof Error ? error.message : String(error) });
    throw new HttpError(503, 'Le quota des recommandations est temporairement indisponible.');
  }

  if (count > WEEKLY_RECOMMENDATION_LIMIT) {
    throw new HttpError(429, 'Quota hebdomadaire de recommandations atteint.', {
      'X-RateLimit-Remaining': '0',
      'X-Reset-At': resetAt.toISOString()
    });
  }

  return { remaining: WEEKLY_RECOMMENDATION_LIMIT - count, resetAt };
}
