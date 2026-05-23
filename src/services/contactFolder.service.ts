import type { HydratedDocument, Types } from 'mongoose';
import { ContactFolder, type IContactFolder } from '../models/ContactFolder.js';
import type { ICompany } from '../models/Company.js';
import { HttpError } from '../utils/httpError.js';

export const defaultContactFolderName = 'Dossier par defaut';

type CreateContactFolderInput = {
  company: HydratedDocument<ICompany>;
  name: string;
  createdBy?: Types.ObjectId | string;
};

export async function createContactFolder({ company, name, createdBy }: CreateContactFolderInput) {
  const existing = await ContactFolder.findOne({
    company: company._id,
    name: name.trim(),
    archivedAt: { $exists: false }
  });
  if (existing) throw new HttpError(409, 'Un dossier porte deja ce nom.');

  return ContactFolder.create({
    company: company._id,
    name: name.trim(),
    createdBy
  });
}

export async function ensureDefaultContactFolder(
  company: HydratedDocument<ICompany>,
  createdBy?: Types.ObjectId | string
) {
  const existing = await ContactFolder.findOne({
    company: company._id,
    isDefault: true,
    archivedAt: { $exists: false }
  });
  if (existing) return existing;

  try {
    return await ContactFolder.create({
      company: company._id,
      name: defaultContactFolderName,
      isDefault: true,
      createdBy
    });
  } catch (error) {
    const fallback = await ContactFolder.findOne({
      company: company._id,
      isDefault: true,
      archivedAt: { $exists: false }
    });
    if (fallback) return fallback;
    throw error;
  }
}

export async function archiveContactFolder(folder: HydratedDocument<IContactFolder>) {
  if (folder.isDefault) throw new HttpError(400, 'Le dossier par defaut ne peut pas etre archive.');
  folder.archivedAt = new Date();
  await folder.save();
  return folder;
}
