import mongoose, { type InferSchemaType, type Types } from 'mongoose';

const contactTagSchema = new mongoose.Schema({
  company: { type: mongoose.Schema.Types.ObjectId, ref: 'Company', required: true, index: true },
  name: { type: String, required: true, trim: true },
  color: { type: String, trim: true },
  archivedAt: { type: Date, index: true },
  createdBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' }
}, { timestamps: true });

contactTagSchema.index({ company: 1, name: 1 }, { unique: true });
contactTagSchema.index({ company: 1, archivedAt: 1 });

export type IContactTag = InferSchemaType<typeof contactTagSchema> & {
  _id: Types.ObjectId;
};

export const ContactTag = mongoose.model<IContactTag>('ContactTag', contactTagSchema);
