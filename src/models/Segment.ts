import mongoose, { type InferSchemaType, type Types } from 'mongoose';

export const segmentTypes = ['dynamic', 'static'] as const;
export const segmentMatchTypes = ['all', 'any'] as const;
export const segmentOperators = [
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
] as const;

const segmentConditionSchema = new mongoose.Schema({
  field: { type: String, required: true, trim: true },
  operator: { type: String, enum: segmentOperators, required: true },
  value: { type: mongoose.Schema.Types.Mixed },
  windowDays: { type: Number, min: 1 }
}, { _id: false });

const segmentSchema = new mongoose.Schema({
  company: { type: mongoose.Schema.Types.ObjectId, ref: 'Company', required: true, index: true },
  name: { type: String, required: true, trim: true },
  description: { type: String, trim: true },
  type: { type: String, enum: segmentTypes, default: 'dynamic', index: true },
  matchType: { type: String, enum: segmentMatchTypes, default: 'all' },
  conditions: [segmentConditionSchema],
  contactCount: { type: Number, default: 0, min: 0 },
  lastCalculatedAt: { type: Date },
  archivedAt: { type: Date, index: true },
  createdBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' }
}, { timestamps: true });

segmentSchema.index({ company: 1, name: 1 }, { unique: true });
segmentSchema.index({ company: 1, archivedAt: 1 });
segmentSchema.index({ company: 1, updatedAt: -1 });

export type ISegment = InferSchemaType<typeof segmentSchema> & {
  _id: Types.ObjectId;
};

export const Segment = mongoose.model<ISegment>('Segment', segmentSchema);
