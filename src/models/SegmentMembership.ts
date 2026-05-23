import mongoose, { type InferSchemaType, type Types } from 'mongoose';

const segmentMembershipSchema = new mongoose.Schema({
  company: { type: mongoose.Schema.Types.ObjectId, ref: 'Company', required: true, index: true },
  segment: { type: mongoose.Schema.Types.ObjectId, ref: 'Segment', required: true, index: true },
  contact: { type: mongoose.Schema.Types.ObjectId, ref: 'Contact', required: true, index: true },
  matchedAt: { type: Date, default: Date.now },
  lastEvaluatedAt: { type: Date, default: Date.now }
}, { timestamps: true });

segmentMembershipSchema.index({ segment: 1, contact: 1 }, { unique: true });
segmentMembershipSchema.index({ company: 1, segment: 1, matchedAt: -1 });
segmentMembershipSchema.index({ company: 1, contact: 1 });

export type ISegmentMembership = InferSchemaType<typeof segmentMembershipSchema> & {
  _id: Types.ObjectId;
};

export const SegmentMembership = mongoose.model<ISegmentMembership>(
  'SegmentMembership',
  segmentMembershipSchema
);
