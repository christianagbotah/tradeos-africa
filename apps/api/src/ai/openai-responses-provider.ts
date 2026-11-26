import type { AiTextProvider, AiTextRequest, AiTextResponse } from "@tradeos/contracts";
import { AiProviderError } from "./provider.js";

interface OpenAiResponsesProviderOptions {
  apiKey?: string;
  model?: string;
  endpoint?: string;
}

interface ResponseEnvelope {
  id?: string;
  output_text?: string;
  output?: Array<{
    type?: string;
    content?: Array<{ type?: string; text?: string; refusal?: string }>;
  }>;
  error?: { message?: string; code?: string };
}

export class OpenAiResponsesProvider implements AiTextProvider {
  private readonly apiKey: string | undefined;
  private readonly model: string | undefined;
  private readonly endpoint: string;

  constructor(options: OpenAiResponsesProviderOptions = {}) {
    this.apiKey = options.apiKey ?? process.env.OPENAI_API_KEY;
    this.model = options.model ?? process.env.TRADEOS_AI_MODEL;
    this.endpoint = options.endpoint ?? "https://api.openai.com/v1/responses";
  }

  async generate(input: AiTextRequest): Promise<AiTextResponse> {
    if (!this.apiKey || !this.model) {
      throw new AiProviderError("AI intelligence is not configured.", 503, "AI_UNAVAILABLE");
    }

    const body: Record<string, unknown> = {
      model: this.model,
      store: false,
      instructions: input.systemInstruction,
      input: [
        {
          role: "user",
          content: [
            {
              type: "input_text",
              text: `${input.prompt}\n\nAuthoritative grounding evidence (JSON):\n${JSON.stringify(input.evidence)}`,
            },
          ],
        },
      ],
    };
    if (input.outputSchema) {
      body.text = {
        format: {
          type: "json_schema",
          name: "tradeos_ai_output",
          strict: true,
          schema: input.outputSchema,
        },
      };
    }

    let response: Response;
    try {
      response = await fetch(this.endpoint, {
        method: "POST",
        headers: {
          authorization: `Bearer ${this.apiKey}`,
          "content-type": "application/json",
        },
        body: JSON.stringify(body),
      });
    } catch {
      throw new AiProviderError("AI provider is unavailable.", 503, "AI_UNAVAILABLE");
    }

    let payload: ResponseEnvelope;
    try {
      payload = await response.json() as ResponseEnvelope;
    } catch {
      throw new AiProviderError("AI provider returned an unreadable response.", 502, "AI_PROVIDER_INVALID_RESPONSE");
    }

    if (!response.ok) {
      if (response.status === 429) {
        throw new AiProviderError("AI provider is temporarily rate limited.", 503, "AI_RATE_LIMITED");
      }
      if (response.status >= 500 || response.status === 401 || response.status === 403) {
        throw new AiProviderError("AI provider is unavailable.", 503, "AI_UNAVAILABLE");
      }
      throw new AiProviderError("AI provider request failed.", 502, "AI_PROVIDER_FAILED");
    }

    const refusal = findRefusal(payload);
    if (refusal) {
      throw new AiProviderError("The AI provider declined this request.", 422, "AI_REFUSED");
    }

    const text = extractText(payload);
    if (!text) {
      throw new AiProviderError("AI provider returned no usable output.", 502, "AI_PROVIDER_INVALID_RESPONSE");
    }

    let structuredOutput: unknown;
    if (input.outputSchema) {
      try {
        structuredOutput = JSON.parse(text);
      } catch {
        throw new AiProviderError("AI provider returned invalid structured output.", 502, "AI_PROVIDER_INVALID_RESPONSE");
      }
    }

    return {
      text,
      structuredOutput,
      providerMetadata: {
        responseId: typeof payload.id === "string" ? payload.id : undefined,
        requestId: response.headers.get("x-request-id") ?? undefined,
        model: this.model,
      },
    };
  }
}

function extractText(payload: ResponseEnvelope): string {
  if (typeof payload.output_text === "string" && payload.output_text.trim()) return payload.output_text.trim();
  const chunks: string[] = [];
  for (const item of payload.output ?? []) {
    for (const content of item.content ?? []) {
      if (content.type === "output_text" && typeof content.text === "string") chunks.push(content.text);
    }
  }
  return chunks.join("\n").trim();
}

function findRefusal(payload: ResponseEnvelope): string | null {
  for (const item of payload.output ?? []) {
    for (const content of item.content ?? []) {
      if (content.type === "refusal" && typeof content.refusal === "string") return content.refusal;
    }
  }
  return null;
}
