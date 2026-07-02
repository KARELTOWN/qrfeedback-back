import { HttpError } from '../utils/httpError.js';

type JsonSchemaCallParams = {
  apiKey: string;
  model: string;
  systemPrompt: string;
  userContent: string;
  schemaName: string;
  schema: unknown;
  timeoutMs?: number;
  maxRetries?: number;
};

type JsonSchemaCallResult = {
  outputText: string;
  usage?: { inputTokens?: number; outputTokens?: number; totalTokens?: number };
};

const RETRYABLE_STATUS = new Set([408, 409, 429, 500, 502, 503, 504]);

function delay(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function requestOnce(params: JsonSchemaCallParams, timeoutMs: number) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch('https://api.openai.com/v1/responses', {
      method: 'POST',
      signal: controller.signal,
      headers: { Authorization: `Bearer ${params.apiKey}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: params.model,
        input: [
          { role: 'system', content: params.systemPrompt },
          { role: 'user', content: params.userContent }
        ],
        text: { format: { type: 'json_schema', name: params.schemaName, strict: true, schema: params.schema } }
      })
    });
  } finally {
    clearTimeout(timeout);
  }
}

/** Calls the OpenAI Responses API with a strict JSON schema, retrying transient failures with backoff. */
export async function callOpenAiJsonSchema(params: JsonSchemaCallParams): Promise<JsonSchemaCallResult> {
  const timeoutMs = params.timeoutMs ?? 20000;
  const maxRetries = params.maxRetries ?? 2;

  let lastError: unknown;
  for (let attempt = 0; attempt <= maxRetries; attempt += 1) {
    let response: Response;
    try {
      response = await requestOnce(params, timeoutMs);
    } catch (error) {
      lastError = error;
      if (attempt === maxRetries) break;
      await delay(300 * 2 ** attempt);
      continue;
    }

    if (!response.ok) {
      if (RETRYABLE_STATUS.has(response.status) && attempt < maxRetries) {
        await delay(300 * 2 ** attempt);
        continue;
      }
      const body = await response.text().catch(() => '');
      console.error('[openai:http-error]', { status: response.status, body: body.slice(0, 300) });
      throw new HttpError(502, 'La génération des recommandations IA a échoué.');
    }

    const result = await response.json() as {
      output_text?: string;
      output?: Array<{ content?: Array<{ type?: string; text?: string }> }>;
      usage?: { input_tokens?: number; output_tokens?: number; total_tokens?: number };
    };
    const outputText = result.output_text || result.output
      ?.flatMap((item) => item.content || [])
      .find((content) => content.type === 'output_text' && typeof content.text === 'string')
      ?.text;
    if (!outputText) {
      console.error('[openai:invalid-response]', { hasOutput: Boolean(result.output?.length) });
      throw new HttpError(502, 'Réponse IA invalide.');
    }

    return {
      outputText,
      usage: result.usage ? {
        inputTokens: result.usage.input_tokens,
        outputTokens: result.usage.output_tokens,
        totalTokens: result.usage.total_tokens
      } : undefined
    };
  }

  console.error('[openai:network-error]', { error: lastError instanceof Error ? lastError.message : String(lastError) });
  throw new HttpError(502, 'La génération des recommandations IA a échoué.');
}
