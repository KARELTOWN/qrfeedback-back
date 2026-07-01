import type { HydratedDocument } from "mongoose";
import type { ICompany } from "../models/Company.js";
import { Review } from "../models/Review.js";
import { callOpenAiJsonSchema } from "./openaiClient.service.js";
import { readFileSecret } from "./fileSecret.service.js";
import { env } from "../config/env.js";
import { HttpError } from "../utils/httpError.js";

const REPLY_SCHEMA = {
  type: "object",
  properties: {
    suggestions: {
      type: "array",
      items: { type: "string" },
      minItems: 1,
      maxItems: 3,
    },
  },
  required: ["suggestions"],
  additionalProperties: false,
};

export async function suggestReviewReply(
  company: HydratedDocument<ICompany>,
  reviewId: string,
): Promise<{ suggestions: string[] }> {
  const review = await Review.findById(reviewId);
  if (!review || String(review.company) !== String(company._id)) {
    throw new HttpError(404, "Avis introuvable.");
  }

  const customAnswerLines = (review.customAnswers ?? [])
    .filter((a) => a.value !== undefined && a.value !== "")
    .map((a) => `${a.label} : ${a.value}`)
    .join("\n");

  const reviewContext = [
    `Note : ${review.rating}/5`,
    review.serviceFeedback ? `Commentaire : ${review.serviceFeedback}` : "",
    customAnswerLines,
  ]
    .filter(Boolean)
    .join("\n");

  const tone = review.rating >= 4 ? "chaleureux et reconnaissant" : review.rating <= 2 ? "empathique et constructif" : "professionnel et bienveillant";

  const apiKey = (await readFileSecret("openaiApiKey")) || process.env.OPENAI_API_KEY;
  if (!apiKey) throw new HttpError(503, "La clé OpenAI n'est pas configurée.");

  const result = await callOpenAiJsonSchema({
    apiKey,
    model: env.openaiRecommendationsModel,
    schemaName: "review_reply_suggestions",
    schema: REPLY_SCHEMA,
    systemPrompt: `Tu es un assistant qui aide les gérants d'entreprises à répondre aux avis clients en ${env.openaiRecommendationsLanguage}.
Génère exactement 3 suggestions de réponse pour l'entreprise "${company.name}".
Chaque suggestion doit être : courte (2-4 phrases), ${tone}, personnalisée au contenu de l'avis, prête à copier-coller.
Ne commence pas par "Bonjour" ni par le nom du client. Reste naturel et humain.`,
    userContent: `Voici l'avis client :\n${reviewContext}`,
    timeoutMs: 20_000,
    maxRetries: 2,
  });

  const parsed = JSON.parse(result.outputText) as { suggestions?: unknown[] };
  const suggestions = Array.isArray(parsed.suggestions)
    ? parsed.suggestions.filter((s): s is string => typeof s === "string" && s.trim().length > 0).slice(0, 3)
    : [];

  if (suggestions.length === 0) throw new HttpError(502, "L'IA n'a pas pu générer de suggestions.");

  return { suggestions };
}
