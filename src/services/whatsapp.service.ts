import Twilio from "twilio";
import { env } from "../config/env.js";
import { readFileSecret } from "./fileSecret.service.js";

function normalizeWhatsapp(number: string) {
  const value = number.startsWith("whatsapp:") ? number : `whatsapp:${number}`;
  return value.replace(/\s+/g, "");
}

async function createClient() {
  const accountSid =
    (await readFileSecret("twilioAccountSid")) || env.twilio.accountSid;
  const authToken =
    (await readFileSecret("twilioAuthToken")) || env.twilio.authToken;
  if (!accountSid || !authToken) return null;
  return Twilio(accountSid, authToken);
}

type SendWhatsappInput = {
  to: string;
  body: string;
};

export async function sendWhatsapp({ to, body }: SendWhatsappInput) {
  const client = await createClient();
  const statusCallback =
    env.twilio.statusCallbackUrl ||
    (env.backendUrl
      ? `${env.backendUrl.replace(/\/$/, "")}/api/webhooks/twilio/status`
      : undefined);
  const payload = {
    from: env.twilio.from,
    to: normalizeWhatsapp(to),
    body,
    ...(statusCallback ? { statusCallback } : {}),
  };

  if (!client) {
    console.log("[whatsapp:mock]", payload);
    return { sid: "mock", status: "queued" };
  }

  return client.messages.create(payload);
}
