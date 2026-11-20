import { randomUUID } from "node:crypto";
import type { MercadoPagoErrorBody, MercadoPagoErrorCause } from "./types.js";

export const DEFAULT_BASE_URL = "https://api.mercadopago.com";
export const DEFAULT_TIMEOUT_MS = 15_000;

export type QueryValue = string | number | boolean | undefined;
export type QueryParams = Readonly<Record<string, QueryValue>>;
export type FetchLike = (input: string, init: RequestInit) => Promise<Response>;

export interface MercadoPagoClientOptions {
  accessToken: string | undefined;
  baseUrl?: string;
  timeoutMs?: number;
  fetch?: FetchLike;
}

export interface PostOptions {
  idempotencyKey?: string;
}

export class MissingAccessTokenError extends Error {
  override name = "MissingAccessTokenError";
  constructor() {
    super(
      "MP_ACCESS_TOKEN is not set. Add it to the env block of this MCP server's config and restart the client.",
    );
  }
}

export interface ApiErrorCause {
  code: string;
  description: string;
}

export class MercadoPagoApiError extends Error {
  override name = "MercadoPagoApiError";
  readonly status: number;
  readonly code: string | undefined;
  readonly causes: readonly ApiErrorCause[];
  readonly requestId: string | undefined;

  constructor(params: {
    status: number;
    message: string;
    code: string | undefined;
    causes: readonly ApiErrorCause[];
    requestId: string | undefined;
  }) {
    super(params.message);
    this.status = params.status;
    this.code = params.code;
    this.causes = params.causes;
    this.requestId = params.requestId;
  }
}

export class MercadoPagoNetworkError extends Error {
  override name = "MercadoPagoNetworkError";
  readonly timedOut: boolean;
  constructor(message: string, timedOut: boolean) {
    super(message);
    this.timedOut = timedOut;
  }
}

export class MercadoPagoClient {
  readonly #accessToken: string | undefined;
  readonly #baseUrl: string;
  readonly #timeoutMs: number;
  readonly #fetch: FetchLike;

  constructor(options: MercadoPagoClientOptions) {
    const token = options.accessToken?.trim();
    this.#accessToken = token === "" ? undefined : token;
    this.#baseUrl = (options.baseUrl ?? DEFAULT_BASE_URL).replace(/\/+$/, "");
    this.#timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
    this.#fetch = options.fetch ?? ((input, init) => fetch(input, init));
  }

  get hasAccessToken(): boolean {
    return this.#accessToken !== undefined;
  }

  get<T>(path: string, query?: QueryParams): Promise<T> {
    return this.#request<T>("GET", path, query, undefined, undefined);
  }

  // Mercado Pago deduplicates POSTs by X-Idempotency-Key. Callers that may retry
  // the same operation should pass a stable key; otherwise each call gets a new one.
  post<T>(path: string, body: unknown, options?: PostOptions): Promise<T> {
    const key = options?.idempotencyKey ?? randomUUID();
    return this.#request<T>("POST", path, undefined, body, key);
  }

  buildUrl(path: string, query?: QueryParams): string {
    const url = new URL(`${this.#baseUrl}${path.startsWith("/") ? path : `/${path}`}`);
    if (query) {
      for (const [key, value] of Object.entries(query)) {
        if (value !== undefined) url.searchParams.set(key, String(value));
      }
    }
    return url.toString();
  }

  async #request<T>(
    method: "GET" | "POST",
    path: string,
    query: QueryParams | undefined,
    body: unknown,
    idempotencyKey: string | undefined,
  ): Promise<T> {
    const token = this.#accessToken;
    if (token === undefined) throw new MissingAccessTokenError();

    const headers: Record<string, string> = {
      Authorization: `Bearer ${token}`,
      Accept: "application/json",
    };
    if (body !== undefined) headers["Content-Type"] = "application/json";
    if (idempotencyKey !== undefined) headers["X-Idempotency-Key"] = idempotencyKey;

    const init: RequestInit = {
      method,
      headers,
      signal: AbortSignal.timeout(this.#timeoutMs),
    };
    if (body !== undefined) init.body = JSON.stringify(body);

    let response: Response;
    let text: string;
    try {
      response = await this.#fetch(this.buildUrl(path, query), init);
      text = await response.text();
    } catch (error) {
      throw this.#toNetworkError(error, method, path);
    }

    const parsed = parseJson(text);
    if (!response.ok) {
      throw this.#toApiError(response, parsed, text);
    }
    if (parsed === undefined) {
      throw new MercadoPagoApiError({
        status: response.status,
        message: `Mercado Pago returned a non-JSON response for ${method} ${path}`,
        code: undefined,
        causes: [],
        requestId: response.headers.get("x-request-id") ?? undefined,
      });
    }
    return parsed as T;
  }

  #toNetworkError(error: unknown, method: string, path: string): MercadoPagoNetworkError {
    const name = error instanceof Error ? error.name : "";
    if (name === "TimeoutError" || name === "AbortError") {
      return new MercadoPagoNetworkError(
        `${method} ${path} timed out after ${this.#timeoutMs} ms`,
        true,
      );
    }
    const detail = error instanceof Error ? error.message : String(error);
    return new MercadoPagoNetworkError(this.#redact(`${method} ${path} failed: ${detail}`), false);
  }

  #toApiError(response: Response, parsed: unknown, rawText: string): MercadoPagoApiError {
    const body: MercadoPagoErrorBody = isRecord(parsed) ? (parsed as MercadoPagoErrorBody) : {};
    const fallback = rawText.trim().slice(0, 200) || response.statusText || "request failed";
    const message =
      typeof body.message === "string" && body.message !== "" ? body.message : fallback;
    return new MercadoPagoApiError({
      status: response.status,
      message: this.#redact(message),
      code: typeof body.error === "string" ? body.error : undefined,
      causes: normalizeCauses(body.cause).map((cause) => ({
        code: cause.code,
        description: this.#redact(cause.description),
      })),
      requestId: response.headers.get("x-request-id") ?? undefined,
    });
  }

  #redact(text: string): string {
    const token = this.#accessToken;
    return token === undefined ? text : text.split(token).join("[redacted]");
  }
}

function parseJson(text: string): unknown {
  if (text.trim() === "") return undefined;
  try {
    return JSON.parse(text) as unknown;
  } catch {
    return undefined;
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

// `cause` comes back as an array, a single object, or null depending on the endpoint.
function normalizeCauses(raw: MercadoPagoErrorBody["cause"]): ApiErrorCause[] {
  if (raw === undefined || raw === null) return [];
  const list: unknown[] = Array.isArray(raw) ? raw : [raw];
  const causes: ApiErrorCause[] = [];
  for (const item of list) {
    if (!isRecord(item)) continue;
    const cause = item as MercadoPagoErrorCause;
    causes.push({
      code: cause.code === undefined ? "" : String(cause.code),
      description: typeof cause.description === "string" ? cause.description : "",
    });
  }
  return causes;
}
