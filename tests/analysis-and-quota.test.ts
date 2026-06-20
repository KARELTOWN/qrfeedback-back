import test from 'node:test';
import assert from 'node:assert/strict';
import { buildRecommendations } from '../src/services/reviewAnalytics.service.js';
import { getIsoWeekWindow } from '../src/services/recommendationRateLimit.service.js';

test('recommendations prioritize urgent feedback before other signals', () => {
  const recommendations = buildRecommendations({
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
