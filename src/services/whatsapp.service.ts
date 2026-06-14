import { env } from '../config/env.js';
import { readFileSecret } from './fileSecret.service.js';

type SendWhatsappInput = {
  to: string;
  body: string;
  template?: {
    name: string;
    language: string;
    parameters: string[];
  };
};

type WhatsAppCloudMessageResponse = {
  messages?: Array<{
    id?: string;
    message_status?: string;
  }>;
};

function maskPhoneNumber(number: string) {
  if (number.length <= 6) return '***';
  return `${number.slice(0, 3)}***${number.slice(-3)}`;
}

function normalizeRecipient(number: string) {
  return number.replace(/^whatsapp:/i, '').replace(/[^\d]/g, '');
}

async function getAccessToken() {
  return readFileSecret('whatsappAccessToken');
}

export async function sendWhatsapp({ to, body, template }: SendWhatsappInput) {
  const accessToken = await getAccessToken();
  const phoneNumberId = env.whatsapp.phoneNumberId;
  const recipient = normalizeRecipient(to);
  const logContext = {
    provider: 'whatsapp_cloud_api',
    graphApiVersion: env.whatsapp.graphApiVersion,
    phoneNumberId: phoneNumberId || 'missing',
    to: maskPhoneNumber(recipient),
    bodyLength: body.length,
    hasAccessToken: Boolean(accessToken),
    messageType: template ? 'template' : 'text',
    templateName: template?.name,
  };

  const payload = template ? {
    messaging_product: 'whatsapp',
    recipient_type: 'individual',
    to: recipient,
    type: 'template',
    template: {
      name: template.name,
      language: {
        code: template.language,
      },
      components: [
        {
          type: 'body',
          parameters: template.parameters.map((parameter) => ({
            type: 'text',
            text: parameter,
          })),
        },
      ],
    },
  } : {
    messaging_product: 'whatsapp',
    recipient_type: 'individual',
    to: recipient,
    type: 'text',
    text: {
      preview_url: false,
      body,
    },
  };

  if (!accessToken || !phoneNumberId) {
    console.warn('[whatsapp:send:mock]', logContext);
    return { id: 'mock', status: 'queued' };
  }

  console.info('[whatsapp:send:start]', logContext);

  const response = await fetch(
    `https://graph.facebook.com/${env.whatsapp.graphApiVersion}/${phoneNumberId}/messages`,
    {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${accessToken}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(payload),
    },
  );

  const data = (await response.json()) as WhatsAppCloudMessageResponse & {
    error?: { message?: string; code?: number; error_subcode?: number };
  };

  if (!response.ok) {
    console.error('[whatsapp:send:error]', {
      ...logContext,
      statusCode: response.status,
      errorCode: data.error?.code,
      errorSubcode: data.error?.error_subcode,
      errorMessage: data.error?.message,
    });
    const errorDetails = [
      data.error?.message || `WhatsApp Cloud API error ${response.status}`,
      data.error?.code ? `code ${data.error.code}` : '',
      data.error?.error_subcode ? `subcode ${data.error.error_subcode}` : '',
    ].filter(Boolean);
    const errorMessage = errorDetails.join(' - ');
    throw new Error(errorMessage);
  }

  const message = data.messages?.[0];
  console.info('[whatsapp:send:success]', {
    ...logContext,
    messageId: message?.id || 'unknown',
    messageStatus: message?.message_status || 'queued',
  });

  return {
    id: message?.id || 'unknown',
    status: message?.message_status || 'queued',
  };
}
