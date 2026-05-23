import mongoose, { type InferSchemaType, type Types } from 'mongoose';

export const contactListMembershipStatuses = [
  'active',
  'unsubscribed',
  'blocked',
  'removed'
] as const;

export type ContactListMembershipStatus = typeof contactListMembershipStatuses[number];

const contactListMembershipSchema = new mongoose.Schema({
  company: { type: mongoose.Schema.Types.ObjectId, ref: 'Company', required: true, index: true },
  list: { type: mongoose.Schema.Types.ObjectId, ref: 'ContactList', required: true, index: true },
  contact: { type: mongoose.Schema.Types.ObjectId, ref: 'Contact', required: true, index: true },
  status: { type: String, enum: contactListMembershipStatuses, default: 'active', index: true },
  attributes: { type: mongoose.Schema.Types.Mixed, default: {} },
  addedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
  addedByAutomation: { type: mongoose.Schema.Types.ObjectId, ref: 'Automation' },
  addedAt: { type: Date, default: Date.now },
  removedAt: { type: Date }
}, { timestamps: true });

contactListMembershipSchema.index({ list: 1, contact: 1 }, { unique: true });
contactListMembershipSchema.index({ company: 1, contact: 1, status: 1 });
contactListMembershipSchema.index({ company: 1, list: 1, status: 1 });

export type IContactListMembership = InferSchemaType<typeof contactListMembershipSchema> & {
  _id: Types.ObjectId;
};

export const ContactListMembership = mongoose.model<IContactListMembership>(
  'ContactListMembership',
  contactListMembershipSchema
);
