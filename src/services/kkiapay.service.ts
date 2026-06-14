import { env } from "../config/env.js";
import { HttpError } from "../utils/httpError.js";

type KkiapayTransaction = {
  transactionId?: string;
  status?: string;
  amount?: number;
  performedAt?: string;
  [key: string]: unknown;
};

function getKkiapayHeaders() {
  if (!env.kkiapay.publicKey || !env.kkiapay.privateKey || !env.kkiapay.secretKey) {
    throw new HttpError(500, "Kkiapay non configure.");
  }

  return {
    "Content-Type": "application/json",
    "x-api-key": env.kkiapay.publicKey,
    "x-private-key": env.kkiapay.privateKey,
    "x-secret-key": env.kkiapay.secretKey,
  };
}

export async function verifyKkiapayTransaction(transactionId: string) {
  const response = await fetch(`${env.kkiapay.apiUrl}/api/v1/transactions/status`, {
    method: "POST",
    headers: getKkiapayHeaders(),
    body: JSON.stringify({ transactionId }),
  });

  const data = (await response.json().catch(() => null)) as KkiapayTransaction | null;
  if (!response.ok || !data) {
    throw new HttpError(response.status || 502, "Verification Kkiapay impossible.");
  }

  return data;
}

export function isKkiapayTransactionSuccessful(transaction: KkiapayTransaction) {
  return ["SUCCESS", "SUCCESSFUL", "PAID", "VALIDATED"].includes(
    String(transaction.status || "").toUpperCase(),
  );
}
