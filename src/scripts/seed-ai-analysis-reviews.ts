import mongoose from 'mongoose';
import { connectDatabase } from '../config/database.js';
import { env } from '../config/env.js';
import { Company } from '../models/Company.js';
import { CompanyQrCode } from '../models/CompanyQrCode.js';
import { Review } from '../models/Review.js';
import { generateQrDataUrl } from '../services/qr.service.js';
import { reindexCompanyReviews } from '../services/typesense.service.js';
import { createSlug } from '../utils/slug.js';

const SEED_BATCH = 'ai-analysis-demo-1000';
const REVIEW_COUNT = 1000;

const args = new Set(process.argv.slice(2));
const shouldReset = args.has('--reset');
const shouldSkipIndex = args.has('--skip-index');

type Topic = {
  label: string;
  impact: 'negative' | 'positive' | 'mixed';
  comments: string[];
};

const topics: Topic[] = [
  {
    label: "Temps d'attente",
    impact: 'negative',
    comments: [
      "L'attente etait trop longue avant d'etre servi, surtout aux heures de pointe.",
      "J'ai attendu longtemps alors que la file n'etait pas tres grande.",
      "Le service est correct, mais le temps d'attente doit vraiment etre reduit.",
      "Beaucoup de retard avant la prise en charge, c'est frustrant.",
      "On sent que l'equipe fait des efforts, mais l'attente reste le principal probleme."
    ]
  },
  {
    label: 'Accueil et service',
    impact: 'mixed',
    comments: [
      "Accueil chaleureux et personnel disponible, bonne experience globale.",
      "Le personnel est poli, mais il manque parfois des explications claires.",
      "Tres bon accueil, j'ai ete oriente rapidement.",
      "Service froid au debut, puis meilleure prise en charge ensuite.",
      "L'agent etait patient et a bien repondu a mes questions."
    ]
  },
  {
    label: 'Qualite du service',
    impact: 'mixed',
    comments: [
      "Le service rendu est satisfaisant et conforme a mes attentes.",
      "Bonne qualite globale, mais quelques details peuvent etre ameliores.",
      "Experience decevante, la prestation n'etait pas au niveau attendu.",
      "Service efficace, resultat propre et rapide.",
      "La qualite varie selon les moments, il faut plus de regularite."
    ]
  },
  {
    label: 'Prix',
    impact: 'mixed',
    comments: [
      "Les prix sont corrects pour la qualite proposee.",
      "Je trouve le tarif un peu cher par rapport au service recu.",
      "Bon rapport qualite prix, rien a signaler.",
      "La facture finale manque de clarte.",
      "Les prix sont acceptables, mais une meilleure explication serait utile."
    ]
  },
  {
    label: 'Disponibilite',
    impact: 'negative',
    comments: [
      "Certains produits etaient indisponibles, j'ai du changer mon choix.",
      "Il y a souvent des ruptures, cela complique l'experience.",
      "La disponibilite est meilleure qu'avant, mais pas encore parfaite.",
      "Service indisponible au moment ou j'en avais besoin.",
      "J'ai trouve ce que je cherchais, mais apres plusieurs tentatives."
    ]
  },
  {
    label: 'Paiement',
    impact: 'mixed',
    comments: [
      "Le paiement mobile a fonctionne rapidement.",
      "Probleme au moment du paiement, la transaction a pris trop de temps.",
      "Paiement simple et confirmation recue sans difficulte.",
      "La caisse etait lente et la monnaie n'etait pas disponible.",
      "Processus de paiement clair, mais il faudrait plus d'options."
    ]
  },
  {
    label: 'Proprete',
    impact: 'mixed',
    comments: [
      "L'espace etait propre et bien organise.",
      "La proprete est correcte, mais les toilettes doivent etre mieux entretenues.",
      "Lieu agreable, propre et rassurant.",
      "Quelques zones etaient sales au moment de mon passage.",
      "Bonne hygiene visible, cela donne confiance."
    ]
  },
  {
    label: 'Experience positive',
    impact: 'positive',
    comments: [
      "Excellent service, rapide et tres professionnel.",
      "Merci pour l'accueil, je suis satisfait de mon passage.",
      "Experience agreable, je recommande sans hesitation.",
      "Tout s'est bien passe, equipe souriante et efficace.",
      "Tres bonne experience client du debut a la fin."
    ]
  }
];

const names = ['Karel', 'Aminata', 'Joel', 'Fatou', 'Serge', 'Mireille', 'Cedric', 'Nadia', 'Aurelien', 'Grace', 'Moussa', 'Chloe'];
const emailDomains = ['gmail.com', 'yahoo.fr', 'outlook.com', 'example.com'];

function ratingForTopic(topic: Topic, index: number) {
  if (topic.impact === 'positive') return [4, 5, 5, 4, 5][index % 5];
  if (topic.impact === 'negative') return [1, 2, 2, 3, 1][index % 5];
  return [2, 3, 4, 3, 5, 2][index % 6];
}

function dateForIndex(index: number) {
  const now = new Date();
  const date = new Date(now.getFullYear(), now.getMonth(), 1);
  date.setDate(date.getDate() - index);
  date.setHours(8 + (index % 12), (index * 7) % 60, 0, 0);
  return date;
}

function buildFeedback(index: number) {
  const topic = topics[index % topics.length];
  const base = topic.comments[index % topic.comments.length];
  const suffixes = [
    "Je souhaite que ce point soit suivi dans les prochains jours.",
    "Globalement l'experience reste utile pour comprendre ce qui doit progresser.",
    "C'est un retour honnete apres mon passage.",
    "Je reviendrai si l'amelioration est visible.",
    "Merci de prendre en compte cette remarque."
  ];
  return `${base} ${suffixes[index % suffixes.length]}`;
}

function buildCustomAnswers(index: number) {
  const name = names[index % names.length];
  const phone = `+22901${String(90000000 + index).slice(0, 8)}`;
  const email = `${name.toLowerCase()}.${index}@${emailDomains[index % emailDomains.length]}`;
  const topic = topics[index % topics.length];

  return [
    { questionId: 'seedBatch', label: 'Seed batch', type: 'text', value: SEED_BATCH },
    { questionId: 'fullName', label: 'Nom complet', type: 'fullName', value: `${name} Client ${index + 1}` },
    { questionId: 'phone', label: 'Telephone', type: 'phone', value: phone },
    { questionId: 'email', label: 'Email', type: 'email', value: email },
    { questionId: 'visitReason', label: 'Motif de visite', type: 'select', value: topic.label },
    { questionId: 'improvement', label: 'A ameliorer', type: 'textarea', value: buildFeedback(index) }
  ];
}

async function findOrCreateQrCode() {
  const existingQrCode = await CompanyQrCode.findOne({ label: 'Avis clients - Seed IA' }).sort({ createdAt: 1 });
  if (existingQrCode) return existingQrCode;

  const company = await Company.findOne({ slug: { $ne: 'qr-feedback-admin' } }).sort({ createdAt: 1 });

  if (!company) {
    throw new Error('Aucune entreprise utilisateur trouvee. Creez un compte entreprise avant de lancer ce seeder.');
  }

  const slug = createSlug(`${company.name}-seed-ai`);
  const feedbackUrl = `${env.frontendUrl}/avis/${slug}`;
  const qrCodeDataUrl = await generateQrDataUrl(feedbackUrl);

  return CompanyQrCode.create({
    company: company._id,
    slug,
    feedbackUrl,
    qrCodeDataUrl,
    label: 'Avis clients - Seed IA',
    notificationPreferences: { emailEnabled: false, telegramEnabled: false }
  });
}

await connectDatabase();

const qrCode = await findOrCreateQrCode();
const company = await Company.findById(qrCode.company);
if (!company) throw new Error('Entreprise associee au QR code introuvable.');

if (shouldReset) {
  const deleted = await Review.deleteMany({
    company: company._id,
    qrCode: qrCode._id,
    'customAnswers.questionId': 'seedBatch',
    'customAnswers.value': SEED_BATCH
  });
  console.log(`Avis seed precedents supprimes: ${deleted.deletedCount}`);
}

const existingSeedCount = await Review.countDocuments({
  company: company._id,
  qrCode: qrCode._id,
  'customAnswers.questionId': 'seedBatch',
  'customAnswers.value': SEED_BATCH
});

if (existingSeedCount >= REVIEW_COUNT && !shouldReset) {
  console.log(`${existingSeedCount} avis seed existent deja pour ce QR code. Utilisez --reset pour les remplacer.`);
  await mongoose.disconnect();
  process.exit(0);
}

const reviews = Array.from({ length: REVIEW_COUNT - existingSeedCount }, (_, index) => {
  const absoluteIndex = existingSeedCount + index;
  const topic = topics[absoluteIndex % topics.length];
  const createdAt = dateForIndex(absoluteIndex);
  return {
    company: company._id,
    qrCode: qrCode._id,
    serviceFeedback: buildFeedback(absoluteIndex),
    customAnswers: buildCustomAnswers(absoluteIndex),
    rating: ratingForTopic(topic, absoluteIndex),
    notificationStatus: 'skipped',
    notificationError: 'Seeder: aucune notification temps reel envoyee.',
    emailNotificationStatus: 'skipped',
    emailNotificationError: 'Seeder: aucune notification email envoyee.',
    notificationEmail: company.email,
    createdAt,
    updatedAt: createdAt
  };
});

if (reviews.length) {
  await Review.insertMany(reviews, { ordered: false });
}

if (!shouldSkipIndex) {
  await reindexCompanyReviews(company);
}

console.log(`Seeder termine: ${reviews.length} avis ajoutes.`);
console.log(`Entreprise: ${company.name} (${company._id})`);
console.log(`QR code: ${qrCode.label || qrCode.slug} (${qrCode._id})`);
console.log('Notifications: aucun envoi effectue, statuts marques skipped.');

await mongoose.disconnect();
process.exit(0);
