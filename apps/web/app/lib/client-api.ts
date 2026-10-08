export class ClientApiError extends Error {
  constructor(
    message: string,
    readonly statusCode: number,
    readonly code: string | null,
  ) {
    super(message);
    this.name = "ClientApiError";
  }
}

export async function clientApi<T = unknown>(url: string, init?: RequestInit): Promise<T> {
  const response = await fetch(url, {
    ...init,
    headers: { "content-type": "application/json", ...(init?.headers ?? {}) },
    cache: "no-store",
  });
  return readResponse<T>(response);
}

export async function readResponse<T>(response: Response): Promise<T> {
  const text = await response.text();
  let body: unknown = null;
  try {
    body = text ? JSON.parse(text) : null;
  } catch {
    body = null;
  }
  if (!response.ok) {
    const candidate = body as { error?: unknown; message?: unknown } | null;
    const message = typeof candidate?.message === "string" ? candidate.message : `Request failed (${response.status})`;
    const code = typeof candidate?.error === "string" ? candidate.error : null;
    throw new ClientApiError(message, response.status, code);
  }
  return body as T;
}

export function messageFrom(reason: unknown): string {
  return reason instanceof Error ? reason.message : "Something went wrong. Please try again.";
}
