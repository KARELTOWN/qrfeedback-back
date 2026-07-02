import { env } from '../config/env.js';

export const reviewsCollectionName = 'reviews';

export function buildReviewsCollectionSchema() {
  return {
    name: reviewsCollectionName,
    fields: [
      { name: 'companyId', type: 'string', facet: true },
      { name: 'qrCodeId', type: 'string', facet: true, optional: true },
      { name: 'qrCodeLabel', type: 'string', facet: true, optional: true },
      { name: 'rating', type: 'int32', facet: true },
      { name: 'sentiment', type: 'string', facet: true },
      { name: 'sentimentScore', type: 'float' },
      { name: 'serviceFeedback', type: 'string', optional: true },
      { name: 'answersText', type: 'string', optional: true },
      { name: 'searchText', type: 'string' },
      { name: 'notificationStatus', type: 'string', facet: true },
      { name: 'createdAt', type: 'int64', sort: true },
      {
        name: 'embedding',
        type: 'float[]',
        embed: {
          from: ['searchText'],
          model_config: { model_name: env.typesense.embeddingModel }
        }
      }
    ],
    default_sorting_field: 'createdAt'
  };
}
