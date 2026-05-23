import mongoose, { type InferSchemaType, type Types } from 'mongoose';

const contactListSchema = new mongoose.Schema({
  company: { type: mongoose.Schema.Types.ObjectId, ref: 'Company', required: true, index: true },
  folder: { type: mongoose.Schema.Types.ObjectId, ref: 'ContactFolder', required: true, index: true },
  name: { type: String, required: true, trim: true },
  description: { type: String, trim: true },
  isDefault: { type: Boolean, default: false, index: true },
  contactCount: { type: Number, default: 0, min: 0 },
  lastCalculatedAt: { type: Date },
  archivedAt: { type: Date, index: true },
  createdBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' }
}, { timestamps: true });

contactListSchema.index({ company: 1, folder: 1, name: 1 }, { unique: true });
contactListSchema.index({ company: 1, isDefault: 1 });
contactListSchema.index({ company: 1, updatedAt: -1 });
contactListSchema.index({ company: 1, archivedAt: 1 });

export type IContactList = InferSchemaType<typeof contactListSchema> & {
  _id: Types.ObjectId;
};

export const ContactList = mongoose.model<IContactList>('ContactList', contactListSchema);
