import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { plans } from '../src/config/plans.js';
import { createPayment } from '../src/services/payment.service.js';
import { sanitizeFeedbackFormConfig } from '../src/services/feedbackForm.service.js';
import { createQrCodeValidator } from '../src/validators/qrcode.validator.js';
import { secretNames } from '../src/models/EncryptedSecret.js';

test('the product exposes a single free unlimited plan', () => {
  assert.equal(plans.length, 1);
  assert.equal(plans[0].code, 'free_unlimited');
  assert.equal(plans[0].priceFcfa, 0);
  assert.equal(plans[0].unlimited, true);
});

test('payment flow is explicitly disabled for the free product', async () => {
  await assert.rejects(
    () => createPayment(),
    (error: unknown) =>
      error instanceof Error &&
      'status' in error &&
      error.status === 410 &&
      error.message.includes('gratuit'),
  );
});

test('notification preferences do not expose a preferred channel concept', () => {
  const userSource = readFileSync(new URL('../src/models/User.ts', import.meta.url), 'utf8');
  const controllerSource = readFileSync(new URL('../src/controllers/notification.controller.ts', import.meta.url), 'utf8');

  assert.doesNotMatch(userSource, /preferredChannel/);
  assert.doesNotMatch(controllerSource, /preferredChannel/);
});

test('public review validation includes Turnstile anti-spam token support', () => {
  const validatorSource = readFileSync(new URL('../src/validators/review.validator.express.ts', import.meta.url), 'utf8');
  assert.match(validatorSource, /turnstileToken/);
});

test('QR code creation validator no longer accepts WhatsApp fields', () => {
  const validatorSource = createQrCodeValidator.map((validator) => String(validator)).join('\n');
  assert.doesNotMatch(validatorSource, /whatsapp/i);
});

test('feedback form sanitization caps custom questions and validates types', () => {
  const config = sanitizeFeedbackFormConfig({
    title: 'Avis',
    customQuestions: Array.from({ length: 12 }, (_, index) => ({
      id: `question_${index}`,
      type: index === 0 ? 'rating' : 'unknown',
      label: `Question ${index}`,
      required: index === 0,
    })),
  }, 'Demo');

  assert.equal(config.customQuestions.length, 8);
  assert.equal(config.customQuestions[0].type, 'rating');
  assert.equal(config.customQuestions[1].type, 'text');
});

test('secret vault only allows active platform secrets', () => {
  assert.deepEqual([...secretNames], ['jwtSecret', 'telegramBotToken', 'telegramWebhookSecret', 'openaiApiKey']);
});

test('admin Telegram ads expose publishing routes and date-window checks', () => {
  const routesSource = readFileSync(new URL('../src/routes/admin.routes.ts', import.meta.url), 'utf8');
  const serviceSource = readFileSync(new URL('../src/services/telegramAd.service.ts', import.meta.url), 'utf8');

  assert.match(routesSource, /telegram-ads/);
  assert.match(routesSource, /publish/);
  assert.match(serviceSource, /startsAt >= endsAt/);
  assert.match(serviceSource, /endsAt < now/);
  assert.match(serviceSource, /broadcastDueTelegramAds/);
});

test('reviews only expose published and archived status actions', () => {
  const reviewModelSource = readFileSync(new URL('../src/models/Review.ts', import.meta.url), 'utf8');
  const botSource = readFileSync(new URL('../src/services/telegramBot.service.ts', import.meta.url), 'utf8');
  const notificationSource = readFileSync(new URL('../src/services/notification.service.ts', import.meta.url), 'utf8');

  assert.match(reviewModelSource, /enum: \['published', 'archived'\]/);
  assert.doesNotMatch(botSource, /review_resolve_|review_hide_|Marquer traite|Masquer/);
  assert.doesNotMatch(notificationSource, /review_resolve_|review_hide_|Marquer traite|Masquer/);
  assert.match(botSource, /review_archive_/);
  assert.match(botSource, /Ajouter une note/);
  assert.match(botSource, /Ajouter un tag/);
});

test('scan to review conversion is tracked and exposed', () => {
  const qrScanModelSource = readFileSync(new URL('../src/models/QrScan.ts', import.meta.url), 'utf8');
  const companyRoutesSource = readFileSync(new URL('../src/routes/company.routes.ts', import.meta.url), 'utf8');
  const dashboardSource = readFileSync(new URL('../src/services/dashboard.service.ts', import.meta.url), 'utf8');
  const qrCodeSource = readFileSync(new URL('../src/services/qrcode.service.ts', import.meta.url), 'utf8');

  assert.match(qrScanModelSource, /idempotencyKey/);
  assert.match(companyRoutesSource, /:slug\/scan/);
  assert.match(dashboardSource, /conversionRate/);
  assert.match(qrCodeSource, /scanCount/);
});
