import { env } from '../config/env.js';
import { readFileSecret } from '../services/fileSecret.service.js';

type MetaTemplateResponse = {
  id?: string;
  status?: string;
  category?: string;
  error?: {
    message?: string;
    type?: string;
    code?: number;
    error_subcode?: number;
    error_user_title?: string;
    error_user_msg?: string;
    fbtrace_id?: string;
  };
};

type PhoneNumberMetadataResponse = {
  whatsapp_business_account?: {
    id?: string;
  };
  error?: {
    message?: string;
    code?: number;
    error_subcode?: number;
  };
};

const templateName = process.env.WHATSAPP_REVIEW_TEMPLATE_NAME || 'nouvel_avis_client';
const templateLanguage = process.env.WHATSAPP_REVIEW_TEMPLATE_LANGUAGE || 'fr';

const components = [
  {
    type: 'BODY',
    text: 'Bonjour, vous avez recu un nouvel avis client pour {{1}}.\n\nNote donnee par le client: {{2}}/5.\nDetails de l avis: {{3}}\n\nConnectez-vous a votre tableau de bord QR Feedback pour consulter l avis complet et suivre vos retours clients.',
    example: {
      body_text: [['PUREMENT NODEJS', '4', 'Nom: TESTING 002']],
    },
  },
];

async function resolveBusinessAccountId(accessToken: string) {
  if (env.whatsapp.businessAccountId) return env.whatsapp.businessAccountId;
  if (!env.whatsapp.phoneNumberId) return null;

  const response = await fetch(
    `https://graph.facebook.com/${env.whatsapp.graphApiVersion}/${env.whatsapp.phoneNumberId}?fields=whatsapp_business_account`,
    {
      headers: {
        Authorization: `Bearer ${accessToken}`,
      },
    },
  );
  const data = (await response.json()) as PhoneNumberMetadataResponse;

  if (!response.ok) {
    console.warn('[whatsapp:template:waba:resolve_failed]', {
      statusCode: response.status,
      errorCode: data.error?.code,
      errorSubcode: data.error?.error_subcode,
      errorMessage: data.error?.message,
    });
    return null;
  }

  return data.whatsapp_business_account?.id || null;
}

async function createTemplate() {
  const accessToken = await readFileSecret('whatsappAccessToken');

  if (!accessToken) {
    throw new Error('Secret whatsappAccessToken introuvable. Lancez npm run secret:set.');
  }

  const businessAccountId = await resolveBusinessAccountId(accessToken);

  if (!businessAccountId) {
    throw new Error('WHATSAPP_BUSINESS_ACCOUNT_ID est manquant dans .env et impossible de le resoudre depuis WHATSAPP_PHONE_NUMBER_ID.');
  }

  const payload = {
    name: templateName,
    language: templateLanguage,
    category: 'UTILITY',
    components,
  };

  console.info('[whatsapp:template:create:start]', {
    businessAccountId,
    graphApiVersion: env.whatsapp.graphApiVersion,
    name: templateName,
    language: templateLanguage,
    category: payload.category,
  });

  const response = await fetch(
    `https://graph.facebook.com/${env.whatsapp.graphApiVersion}/${businessAccountId}/message_templates`,
    {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${accessToken}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(payload),
    },
  );

  const data = (await response.json()) as MetaTemplateResponse;

  if (!response.ok) {
    console.error('[whatsapp:template:create:error]', {
      statusCode: response.status,
      errorCode: data.error?.code,
      errorSubcode: data.error?.error_subcode,
      errorType: data.error?.type,
      errorMessage: data.error?.message,
      errorUserTitle: data.error?.error_user_title,
      errorUserMessage: data.error?.error_user_msg,
      fbtraceId: data.error?.fbtrace_id,
    });
    process.exitCode = 1;
    return;
  }

  console.info('[whatsapp:template:create:success]', {
    id: data.id,
    status: data.status,
    category: data.category,
    name: templateName,
    language: templateLanguage,
  });
}

createTemplate().catch((error) => {
  console.error('[whatsapp:template:create:fatal]', {
    message: error instanceof Error ? error.message : 'Erreur inconnue',
  });
  process.exitCode = 1;
});
