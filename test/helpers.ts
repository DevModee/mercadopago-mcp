import type { FetchLike } from "../src/mp/client.js";

export const FAKE_TOKEN = "test_token_unused";

export interface RecordedCall {
  url: string;
  init: RequestInit;
}

export interface MockFetch {
  fetch: FetchLike;
  calls: RecordedCall[];
}

export function mockFetch(
  respond: (url: string, init: RequestInit) => Response | Promise<Response>,
): MockFetch {
  const calls: RecordedCall[] = [];
  return {
    calls,
    fetch: async (url, init) => {
      calls.push({ url, init });
      return respond(url, init);
    },
  };
}

export function jsonResponse(body: unknown, status = 200, headers: Record<string, string> = {}): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json", ...headers },
  });
}

export function header(init: RequestInit, name: string): string | undefined {
  const headers = init.headers as Record<string, string> | undefined;
  return headers?.[name];
}
