import test from 'node:test';
import assert from 'node:assert/strict';
import { buildRecommendations, problemClusters, sentimentSummary, isUrgentReview } from '../src/services/reviewAnalytics.service.js';
import { getIsoWeekWindow } from '../src/services/recommendationRateLimit.service.js';
import { buildVerbatims } from '../src/services/pdfReportKit.js';

function fakeReview(overrides: Record<string, unknown>) {
  return {
    _id: overrides.id || 'review-id',
    rating: 3,
    serviceFeedback: '',
    customAnswers: [],
    createdAt: new Date('2026-01-01T00:00:00.000Z'),
    qrCode: undefined,
    ...overrides
  };
}

test('recommendations prioritize urgent feedback before other signals', async (t) => {
  process.env.OPENAI_API_KEY = 'test-key';
  t.after(() => { delete process.env.OPENAI_API_KEY; });

  const fakeRecommendation = { priority: 'high', title: 'Traiter les avis urgents', action: 'Contacter les clients urgents.', reason: 'Avis marqués urgents.' };
  const originalFetch = globalThis.fetch;
  globalThis.fetch = (async () => new Response(JSON.stringify({ output_text: JSON.stringify({ recommendations: [fakeRecommendation] }) }), { status: 200 })) as typeof fetch;
  t.after(() => { globalThis.fetch = originalFetch; });

  const recommendations = await buildRecommendations('company-1', {
    reviews: { urgent: [{ id: '1' }] },
    comparison: { averageRatingDelta: -0.4 },
    scans: { conversionRate: 5 },
    topics: [{ label: "Temps d'attente", count: 4, negativeCount: 3, impact: 'high' }]
  });

  assert.equal(recommendations[0]?.priority, 'high');
  assert.match(recommendations[0]?.title || '', /urgents/i);
  assert.ok(recommendations.length <= 4);
});

test('ISO quota window resets at the following Monday midnight', () => {
  const window = getIsoWeekWindow(new Date('2026-06-17T12:00:00.000Z'), 'UTC');
  assert.equal(window.isoWeek, '2026-25');
  assert.equal(window.resetAt.toISOString(), '2026-06-22T00:00:00.000Z');
});

test('problemClusters detects keyword-based topics shared by the live analysis and the PDF reports', () => {
  const reviews = [
    fakeReview({ id: '1', rating: 2, serviceFeedback: "L'attente était beaucoup trop longue avant d'être servi." }),
    fakeReview({ id: '2', rating: 5, serviceFeedback: 'Service rapide et personnel sympathique.' })
  ];

  const clusters = problemClusters(reviews as never);
  const waitingTopic = clusters.find((cluster) => cluster.key === 'waiting_time');

  assert.ok(waitingTopic, 'expected the waiting_time topic to be detected');
  assert.equal(waitingTopic?.count, 1);
});

test('sentimentSummary exposes positive/neutral/negative rates that sum to the review count', () => {
  const reviews = [
    fakeReview({ id: '1', rating: 5, serviceFeedback: 'Super accueil et plats excellents.' }),
    fakeReview({ id: '2', rating: 1, serviceFeedback: 'Très déçu, service lent.' }),
    fakeReview({ id: '3', rating: 3, serviceFeedback: 'Expérience correcte sans plus.' })
  ];

  const summary = sentimentSummary(reviews as never);

  assert.equal(summary.positive + summary.neutral + summary.negative, reviews.length);
  assert.equal(typeof summary.neutralRate, 'number');
});

test('isUrgentReview flags very negative reviews even without an explicit "urgent" keyword', () => {
  const silentlyBad = fakeReview({ rating: 1, serviceFeedback: 'Plat froid et service désagréable, je ne reviendrai pas.' });
  const fine = fakeReview({ rating: 5, serviceFeedback: 'Tout était parfait, merci !' });

  assert.equal(isUrgentReview(silentlyBad as never), true);
  assert.equal(isUrgentReview(fine as never), false);
});

test('buildVerbatims picks one representative review per sentiment for the weekly and export PDFs', () => {
  const reviews = [
    fakeReview({ id: '1', rating: 5, serviceFeedback: 'Super accueil et plats excellents, je recommande vivement ce restaurant.' }),
    fakeReview({ id: '2', rating: 1, serviceFeedback: 'Très déçu, le service était lent et désagréable.' }),
    fakeReview({ id: '3', rating: 3, serviceFeedback: 'Expérience correcte sans plus.' })
  ];

  const verbatims = buildVerbatims(reviews as never);

  assert.equal((verbatims.positive as { _id: string } | null)?._id, '1');
  assert.equal((verbatims.negative as { _id: string } | null)?._id, '2');
  assert.equal((verbatims.neutral as { _id: string } | null)?._id, '3');
});
