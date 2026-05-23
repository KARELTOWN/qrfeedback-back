import { body, param } from 'express-validator';

export const segmentConditionValidator = [
  body('conditions').optional().isArray().withMessage('Les conditions doivent etre une liste.'),
  body('conditions.*.field').optional().isString().trim().notEmpty(),
  body('conditions.*.operator')
    .optional()
    .isIn([
      'exists',
      'not_exists',
      'equals',
      'not_equals',
      'contains',
      'not_contains',
      'starts_with',
      'in',
      'not_in',
      '<',
      '<=',
      '>',
      '>=',
      'within_last_days',
      'older_than_days'
    ])
    .withMessage('Operateur invalide.'),
  body('conditions.*.windowDays').optional().isInt({ min: 1 })
];

export const createSegmentValidator = [
  body('name').trim().isLength({ min: 2, max: 120 }).withMessage('Nom de segment invalide.'),
  body('description').optional({ values: 'falsy' }).isString().trim(),
  body('type').optional().isIn(['dynamic', 'static']),
  body('matchType').optional().isIn(['all', 'any']),
  ...segmentConditionValidator,
  body('contactIds').optional().isArray().withMessage('Les contacts selectionnes doivent etre une liste.'),
  body('contactIds.*').optional().isMongoId().withMessage('Contact invalide.')
];

export const updateSegmentValidator = [
  param('id').isMongoId().withMessage('Segment invalide.'),
  body('name').optional().trim().isLength({ min: 2, max: 120 }).withMessage('Nom de segment invalide.'),
  body('description').optional({ values: 'falsy' }).isString().trim(),
  body('type').optional().isIn(['dynamic', 'static']),
  body('matchType').optional().isIn(['all', 'any']),
  ...segmentConditionValidator,
  body('contactIds').optional().isArray().withMessage('Les contacts selectionnes doivent etre une liste.'),
  body('contactIds.*').optional().isMongoId().withMessage('Contact invalide.')
];

export const segmentIdValidator = [
  param('id').isMongoId().withMessage('Segment invalide.')
];
