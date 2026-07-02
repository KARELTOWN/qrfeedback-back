import { connectDatabase } from "../config/database.js";
import { NotificationTemplate } from "../models/NotificationTemplate.js";
import type { NotificationTemplateInput } from "../services/notificationTemplate.service.js";

const vars = (...keys: string[]) => keys.map((key) => ({ key, label: `#${key}` }));

const templates: NotificationTemplateInput[] = [
  { name: "auth-otp", label: "Code de vérification", emailTitle: "#purpose QR Feedback", emailTemplate: "<p>Bonjour,</p><p>Votre code est :</p><p style=\"font-size:28px;font-weight:700;letter-spacing:4px\">#code</p><p>#resetMessage</p><p>Ce code expire dans #expiresIn.</p>", smsTitle: "QrFeedback", smsTemplate: "#purpose : votre code est #code. Il expire dans #expiresIn.", emailVariables: vars("purpose", "code", "resetMessage", "expiresIn"), smsVariables: vars("purpose", "code", "expiresIn") },
  { name: "company-qr-code-ready", label: "QR code prêt", emailTitle: "Votre QR Code de collecte d’avis", emailTemplate: "<p>Bonjour #companyName,</p><p>Votre lien de collecte est prêt : <a href=\"#feedbackUrl\">#feedbackUrl</a>.</p><p>Vous recevrez les nouveaux avis par e-mail. Connectez-vous ensuite à QrFeedback pour activer Telegram.</p>", smsTitle: "QR Feedback", smsTemplate: "Bonjour #companyName, votre lien de collecte est prêt : #feedbackUrl", emailVariables: vars("companyName", "feedbackUrl"), smsVariables: vars("companyName", "feedbackUrl") },
  { name: "review-new-company", label: "Nouvel avis — entreprise", emailTitle: "Nouvel avis client - #companyName", emailTemplate: "<p>Bonjour #companyName,</p><p>Un nouvel avis vient d’être reçu.</p><p><strong>Note :</strong> #rating/5</p><p><strong>Expérience :</strong><br>#serviceFeedback</p><p><a href=\"#dashboardUrl\">Voir mes avis</a></p>", smsTitle: "Nouvel avis", smsTemplate: "#companyName : nouvel avis #rating/5. #serviceFeedback", emailVariables: vars("companyName", "rating", "serviceFeedback", "dashboardUrl"), smsVariables: vars("companyName", "rating", "serviceFeedback") },
  { name: "review-new-user", label: "Nouvel avis — utilisateur", emailTitle: "Nouvel avis pour #companyName", emailTemplate: "<p>Bonjour,</p><p>Nouvel avis pour <strong>#companyName</strong>.</p><p><strong>Note :</strong> #rating/5</p><p>#serviceFeedback</p>", smsTitle: "Nouvel avis", smsTemplate: "Nouvel avis pour #companyName : #rating/5", emailVariables: vars("companyName", "rating", "serviceFeedback"), smsVariables: vars("companyName", "rating") },
  { name: "invoice-issued", label: "Facture", emailTitle: "Facture #invoiceNumber", emailTemplate: "<p>Bonjour #companyName,</p><p>Votre paiement a été confirmé.</p><p>Facture : <strong>#invoiceNumber</strong></p><p>Montant : #amountFcfa FCFA.</p><p>#passwordMessage</p>", smsTitle: "Facture QrFeedback", smsTemplate: "Paiement confirmé. Facture #invoiceNumber, montant #amountFcfa FCFA.", emailVariables: vars("companyName", "invoiceNumber", "amountFcfa", "passwordMessage"), smsVariables: vars("invoiceNumber", "amountFcfa") },
  { name: "admin-password-reset", label: "Mot de passe généré", emailTitle: "Nouveau mot de passe QR Feedback", emailTemplate: "<p>Bonjour,</p><p>Un nouveau mot de passe a été généré pour votre compte :</p><p style=\"font-size:20px;font-weight:700\">#password</p><p>Connectez-vous puis changez-le depuis vos réglages.</p>", smsTitle: "Mot de passe QrFeedback", smsTemplate: "Votre nouveau mot de passe temporaire est : #password", emailVariables: vars("password"), smsVariables: vars("password") },
  { name: "review-client-email-reply", label: "Merci client — email automatique", emailTitle: "Merci pour votre avis sur #companyName !", emailTemplate: "<p>Bonjour,</p><p>Merci d'avoir pris le temps de partager votre expérience avec <strong>#companyName</strong>.</p><p>Votre avis est précieux et nous aide à améliorer continuellement notre service.</p><p>Nous espérons vous revoir bientôt !</p><p style=\"margin-top:24px;color:#64748b;font-size:13px\">Ce message a été envoyé automatiquement suite à votre avis.</p>", smsTitle: "Merci", smsTemplate: "Merci pour votre avis sur #companyName ! Votre retour nous aide à améliorer notre service. À bientôt !", emailVariables: vars("companyName"), smsVariables: vars("companyName") },
];

await connectDatabase();
for (const template of templates) {
  await NotificationTemplate.updateOne(
    { name: template.name },
    { $setOnInsert: template },
    { upsert: true },
  );
}
console.info(`[notification-templates:seeded] ${templates.length} modèles disponibles`);
process.exit(0);
