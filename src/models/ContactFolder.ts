import mongoose, { type InferSchemaType, type Types } from 'mongoose';

const contactFolderSchema = new mongoose.Schema({
  company: { type: mongoose.Schema.Types.ObjectId, ref: 'Company', required: true, index: true },
  name: { type: String, required: true, trim: true },
  isDefault: { type: Boolean, default: false, index: true },
  archivedAt: { type: Date, index: true },
  createdBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' }
}, { timestamps: true });

contactFolderSchema.index({ company: 1, name: 1 }, { unique: true });
contactFolderSchema.index({ company: 1, isDefault: 1 });
contactFolderSchema.index({ company: 1, archivedAt: 1 });

export type IContactFolder = InferSchemaType<typeof contactFolderSchema> & {
  _id: Types.ObjectId;
};

export const ContactFolder = mongoose.model<IContactFolder>('ContactFolder', contactFolderSchema);
