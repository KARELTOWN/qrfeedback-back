import test from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import { verifyTelegramWebAppInitData } from '../src/services/auth.service.js';

function signedInitData(user: Record<string, unknown>, authDate = Math.floor(Date.now() / 1000)) {
  const token = '123456:test-token';
  const values = new URLSearchParams({ auth_date: String(authDate), query_id: 'query-id', user: JSON.stringify(user) });
  const dataCheckString = [...values.entries()].sort(([left], [right]) => left.localeCompare(right)).map(([key, value]) => `${key}=${value}`).join('\n');
  const secret = crypto.createHmac('sha256', 'WebAppData').update(token).digest();
  values.set('hash', crypto.createHmac('sha256', secret).update(dataCheckString).digest('hex'));
  return { token, initData: values.toString() };
}

test('validates signed Telegram Web App identity', () => {
  const payload = signedInitData({ id: 123456, first_name: 'Ada', username: 'ada' });
  assert.deepEqual(verifyTelegramWebAppInitData(payload.initData, payload.token, 3600), {
    id: '123456', firstName: 'Ada', username: 'ada', lastName: undefined,
  });
});

test('rejects tampered Telegram Web App payloads and expired sessions', () => {
  const payload = signedInitData({ id: 123456, first_name: 'Ada' });
  assert.throws(() => verifyTelegramWebAppInitData(`${payload.initData}&start_param=forged`, payload.token, 3600));
  const expired = signedInitData({ id: 123456, first_name: 'Ada' }, Math.floor(Date.now() / 1000) - 3601);
  assert.throws(() => verifyTelegramWebAppInitData(expired.initData, expired.token, 3600));
});
