import type { AiTextProvider, AiTextRequest, AiTextResponse } from "@tradeos/contracts";

export type { AiTextProvider, AiTextRequest, AiTextResponse };

export class AiProviderError extends Error {
  constructor(
    message: string,
    readonly statusCode: number,
    readonly code: string,
  ) {
    super(message);
    this.name = "AiProviderError";
  }
}
