import mongoose, { type InferSchemaType, type Types } from 'mongoose';

export const contactListAttributeTypes = [
  'text',
  'textarea',
  'email',
  'phone',
  'whatsapp',
  'number',
  'rating',
  'date',
  'boolean',
  'select',
  'multi_select',
  'tag'
] as const;

export const defaultContactAttributeKeys = [
  'first_name',
  'last_name',
  'email',
  'phone',
  'whatsapp',
  'rating',
  'tags',
  'created_at',
  'updated_at'
] as const;

export type ContactListAttributeType = typeof contactListAttributeTypes[number];
export type DefaultContactAttributeKey = typeof defaultContactAttributeKeys[number];

const attributeKeyPattern = /^[a-z][a-z0-9_]{1,63}$/;

const contactListAttributeSchema = new mongoose.Schema({
  company: { type: mongoose.Schema.Types.ObjectId, ref: 'Company', required: true, index: true },
  list: { type: mongoose.Schema.Types.ObjectId, ref: 'ContactList', required: true, index: true },
  key: {
    type: String,
    required: true,
    trim: true,
    lowercase: true,
    minlength: 2,
    maxlength: 64,
    match: attributeKeyPattern
  },
  label: { type: String, required: true, trim: true },
  type: { type: String, enum: contactListAttributeTypes, required: true },
  isSystem: { type: Boolean, default: false, index: true },
  isRequired: { type: Boolean, default: false },
  isUnique: { type: Boolean, default: false },
  options: [{ type: String, trim: true }],
  defaultValue: { type: mongoose.Schema.Types.Mixed },
  position: { type: Number, default: 0 }
}, { timestamps: true });

contactListAttributeSchema.index({ list: 1, key: 1 }, { unique: true });
contactListAttributeSchema.index({ company: 1, list: 1, position: 1 });

export type IContactListAttribute = InferSchemaType<typeof contactListAttributeSchema> & {
  _id: Types.ObjectId;
};

export const ContactListAttribute = mongoose.model<IContactListAttribute>(
  'ContactListAttribute',
  contactListAttributeSchema
);
