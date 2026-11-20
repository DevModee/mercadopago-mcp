import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  MercadoPagoApiError,
  MercadoPagoClient,
  MercadoPagoNetworkError,
  MissingAccessTokenError,
} from "../src/mp/client.js";
import { FAKE_TOKEN, header, jsonResponse, mockFetch } from "./helpers.js";

describe("MercadoPagoClient", () => {
  it("sends GET with bearer token and encoded query", async () => {
    const mock = mockFetch(() => jsonResponse({ ok: true }));
    const client = new MercadoPagoClient({ accessToken: FAKE_TOKEN, fetch: mock.fetch });

    const result = await client.get<{ ok: boolean }>("/v1/payments/search", {
      "payer.email": "buyer+1@example.com",
      limit: 10,
      skipped: undefined,
    });

    assert.deepEqual(result, { ok: true });
    assert.equal(mock.calls.length, 1);
    const call = mock.calls[0]!;
    const url = new URL(call.url);
    assert.equal(url.origin + url.pathname, "https://api.mercadopago.com/v1/payments/search");
    assert.equal(url.searchParams.get("payer.email"), "buyer+1@example.com");
    assert.equal(url.searchParams.get("limit"), "10");
    assert.equal(url.searchParams.has("skipped"), false);
    assert.equal(call.init.method, "GET");
    assert.equal(header(call.init, "Authorization"), `Bearer ${FAKE_TOKEN}`);
    assert.ok(call.init.signal instanceof AbortSignal);
  });

  it("sends POST with JSON body and idempotency key", async () => {
    const mock = mockFetch(() => jsonResponse({ id: 1 }, 201));
    const client = new MercadoPagoClient({ accessToken: FAKE_TOKEN, fetch: mock.fetch });

    await client.post("/v1/payments/1/refunds", { amount: 5 }, { idempotencyKey: "retry-key-123" });
    await client.post("/v1/payments/1/refunds", {});

    const [first, second] = mock.calls;
    assert.equal(first!.init.body, JSON.stringify({ amount: 5 }));
    assert.equal(header(first!.init, "Content-Type"), "application/json");
    assert.equal(header(first!.init, "X-Idempotency-Key"), "retry-key-123");
    assert.match(header(second!.init, "X-Idempotency-Key") ?? "", /^[0-9a-f-]{36}$/);
  });

  it("throws MissingAccessTokenError without calling fetch", async () => {
    const mock = mockFetch(() => jsonResponse({}));
    for (const token of [undefined, "", "   "]) {
      const client = new MercadoPagoClient({ accessToken: token, fetch: mock.fetch });
      assert.equal(client.hasAccessToken, false);
      await assert.rejects(client.get("/v1/payments/1"), MissingAccessTokenError);
    }
    assert.equal(mock.calls.length, 0);
  });

  it("normalizes Mercado Pago error bodies", async () => {
    const mock = mockFetch(() =>
      jsonResponse(
        {
          message: "Payment not found",
          error: "not_found",
          status: 404,
          cause: [{ code: 2000, description: "Payment not found" }],
        },
        404,
        { "x-request-id": "req-abc" },
      ),
    );
    const client = new MercadoPagoClient({ accessToken: FAKE_TOKEN, fetch: mock.fetch });

    await assert.rejects(client.get("/v1/payments/999"), (error: unknown) => {
      assert.ok(error instanceof MercadoPagoApiError);
      assert.equal(error.status, 404);
      assert.equal(error.code, "not_found");
      assert.equal(error.message, "Payment not found");
      assert.deepEqual(error.causes, [{ code: "2000", description: "Payment not found" }]);
      assert.equal(error.requestId, "req-abc");
      return true;
    });
  });

  it("accepts a single-object cause and non-JSON error bodies", async () => {
    let body: string = JSON.stringify({ message: "bad", cause: { code: "x1", description: "d" } });
    const mock = mockFetch(() => new Response(body, { status: 400 }));
    const client = new MercadoPagoClient({ accessToken: FAKE_TOKEN, fetch: mock.fetch });

    await assert.rejects(client.get("/x"), (error: unknown) => {
      assert.ok(error instanceof MercadoPagoApiError);
      assert.deepEqual(error.causes, [{ code: "x1", description: "d" }]);
      return true;
    });

    body = "<html>Bad Gateway</html>";
    await assert.rejects(client.get("/x"), (error: unknown) => {
      assert.ok(error instanceof MercadoPagoApiError);
      assert.equal(error.status, 400);
      assert.equal(error.message, "<html>Bad Gateway</html>");
      assert.deepEqual(error.causes, []);
      return true;
    });
  });

  it("rejects non-JSON success bodies", async () => {
    const mock = mockFetch(() => new Response("ok", { status: 200 }));
    const client = new MercadoPagoClient({ accessToken: FAKE_TOKEN, fetch: mock.fetch });
    await assert.rejects(client.get("/x"), MercadoPagoApiError);
  });

  it("never leaks the access token in error messages", async () => {
    const mock = mockFetch(() =>
      jsonResponse({ message: `invalid token ${FAKE_TOKEN}`, cause: [{ description: FAKE_TOKEN }] }, 401),
    );
    const client = new MercadoPagoClient({ accessToken: FAKE_TOKEN, fetch: mock.fetch });
    await assert.rejects(client.get("/x"), (error: unknown) => {
      assert.ok(error instanceof MercadoPagoApiError);
      assert.ok(!JSON.stringify({ m: error.message, c: error.causes }).includes(FAKE_TOKEN));
      assert.match(error.message, /\[redacted\]/);
      return true;
    });
  });

  it("reports timeouts as MercadoPagoNetworkError", async () => {
    const fetch = (_url: string, init: RequestInit) =>
      new Promise<Response>((_resolve, reject) => {
        init.signal?.addEventListener("abort", () => reject(init.signal?.reason));
      });
    const client = new MercadoPagoClient({ accessToken: FAKE_TOKEN, fetch, timeoutMs: 20 });
    await assert.rejects(client.get("/slow"), (error: unknown) => {
      assert.ok(error instanceof MercadoPagoNetworkError);
      assert.equal(error.timedOut, true);
      assert.match(error.message, /timed out after 20 ms/);
      return true;
    });
  });

  it("reports connection failures as MercadoPagoNetworkError", async () => {
    const client = new MercadoPagoClient({
      accessToken: FAKE_TOKEN,
      fetch: () => Promise.reject(new TypeError("fetch failed")),
    });
    await assert.rejects(client.get("/x"), (error: unknown) => {
      assert.ok(error instanceof MercadoPagoNetworkError);
      assert.equal(error.timedOut, false);
      return true;
    });
  });
});
