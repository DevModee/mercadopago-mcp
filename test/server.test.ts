import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import { MercadoPagoClient, type FetchLike } from "../src/mp/client.js";
import { createServer } from "../src/server.js";
import { FAKE_TOKEN, jsonResponse, mockFetch } from "./helpers.js";

const READ_TOOLS = [
  "get_merchant_order",
  "get_payment",
  "get_preference",
  "list_payment_methods",
  "search_payments",
  "verify_webhook_signature",
];
const WRITE_TOOLS = ["create_preference", "refund_payment"];

interface ConnectOptions {
  allowWrites: boolean;
  token?: string;
  fetch?: FetchLike;
  webhookSecret?: string;
}

async function connect(options: ConnectOptions): Promise<Client> {
  const mpClient = new MercadoPagoClient({
    accessToken: options.token,
    fetch: options.fetch ?? (() => Promise.reject(new Error("fetch should not be called"))),
  });
  const server = createServer({
    client: mpClient,
    allowWrites: options.allowWrites,
    webhookSecret: options.webhookSecret,
  });
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  await server.connect(serverTransport);
  const client = new Client({ name: "test", version: "0.0.0" });
  await client.connect(clientTransport);
  return client;
}

function text(result: unknown): string {
  const content = (result as CallToolResult).content[0];
  assert.ok(content && content.type === "text");
  return content.text;
}

describe("tool registration", () => {
  it("registers only read-only tools by default", async () => {
    const client = await connect({ allowWrites: false });
    const { tools } = await client.listTools();
    assert.deepEqual(tools.map((t) => t.name).sort(), READ_TOOLS);
    for (const tool of tools) assert.equal(tool.annotations?.readOnlyHint, true, tool.name);
    await client.close();
  });

  it("adds write tools with allowWrites", async () => {
    const client = await connect({ allowWrites: true });
    const { tools } = await client.listTools();
    assert.deepEqual(tools.map((t) => t.name).sort(), [...READ_TOOLS, ...WRITE_TOOLS].sort());
    const refund = tools.find((t) => t.name === "refund_payment");
    assert.equal(refund?.annotations?.destructiveHint, true);
    await client.close();
  });

  it("refuses calls to write tools when they are not registered", async () => {
    const client = await connect({ allowWrites: false });
    const result = await client.callTool({
      name: "refund_payment",
      arguments: { payment_id: "1", full_refund: true },
    });
    assert.equal(result.isError, true);
    await client.close();
  });
});

describe("tool calls", () => {
  it("returns a clear tool error when MP_ACCESS_TOKEN is missing", async () => {
    const client = await connect({ allowWrites: false });
    const result = await client.callTool({ name: "get_payment", arguments: { payment_id: "123" } });
    assert.equal(result.isError, true);
    assert.match(text(result), /MP_ACCESS_TOKEN is not set/);
    await client.close();
  });

  it("verifies webhooks without an access token", async () => {
    const client = await connect({ allowWrites: false, webhookSecret: "test_webhook_secret_unused" });
    const result = await client.callTool({
      name: "verify_webhook_signature",
      arguments: {
        x_signature: "ts=1742505638683,v1=0163c308a073154a8127008a19af97a31cd5b57bb348b5e122b20c4dabe312b1",
        x_request_id: "bb56a2f1-6aae-46ac-982e-9dcd3581d08e",
        data_id: "123456789",
      },
    });
    assert.notEqual(result.isError, true);
    assert.equal(JSON.parse(text(result)).valid, true);
    await client.close();
  });

  it("asks for a secret when none is configured", async () => {
    const client = await connect({ allowWrites: false });
    const result = await client.callTool({
      name: "verify_webhook_signature",
      arguments: { x_signature: "ts=1,v1=00" },
    });
    assert.equal(result.isError, true);
    assert.match(text(result), /MP_WEBHOOK_SECRET/);
    await client.close();
  });

  it("calls the payments API and returns compact search results", async () => {
    const mock = mockFetch(() =>
      jsonResponse({
        paging: { total: 1, limit: 30, offset: 0 },
        results: [
          {
            id: 123,
            status: "approved",
            date_created: "2026-01-15T10:00:00.000-03:00",
            currency_id: "ARS",
            transaction_amount: 100,
            point_of_interaction: { large: "payload" },
          },
        ],
      }),
    );
    const client = await connect({ allowWrites: false, token: FAKE_TOKEN, fetch: mock.fetch });
    const result = await client.callTool({
      name: "search_payments",
      arguments: { status: "approved", begin_date: "NOW-1DAYS" },
    });
    assert.notEqual(result.isError, true);
    const body = JSON.parse(text(result));
    assert.equal(body.paging.total, 1);
    assert.equal(body.results[0].id, 123);
    assert.equal(body.results[0].point_of_interaction, undefined);

    const url = new URL(mock.calls[0]!.url);
    assert.equal(url.pathname, "/v1/payments/search");
    assert.equal(url.searchParams.get("status"), "approved");
    assert.equal(url.searchParams.get("range"), "date_created");
    await client.close();
  });

  it("formats API errors as tool errors", async () => {
    const mock = mockFetch(() =>
      jsonResponse({ message: "Payment not found", error: "not_found", status: 404, cause: [] }, 404),
    );
    const client = await connect({ allowWrites: false, token: FAKE_TOKEN, fetch: mock.fetch });
    const result = await client.callTool({ name: "get_payment", arguments: { payment_id: 999 } });
    assert.equal(result.isError, true);
    assert.match(text(result), /Mercado Pago API error 404 \(not_found\): Payment not found/);
    assert.equal(new URL(mock.calls[0]!.url).pathname, "/v1/payments/999");
    await client.close();
  });

  it("posts refunds with the explicit amount when writes are enabled", async () => {
    const mock = mockFetch(() =>
      jsonResponse(
        { id: 1, payment_id: 123, amount: 10, status: "approved", date_created: "2026-01-15" },
        201,
      ),
    );
    const client = await connect({ allowWrites: true, token: FAKE_TOKEN, fetch: mock.fetch });
    const result = await client.callTool({
      name: "refund_payment",
      arguments: { payment_id: "123", amount: 10 },
    });
    assert.notEqual(result.isError, true);
    const call = mock.calls[0]!;
    assert.equal(new URL(call.url).pathname, "/v1/payments/123/refunds");
    assert.equal(call.init.method, "POST");
    assert.equal(call.init.body, JSON.stringify({ amount: 10 }));
    await client.close();
  });
});
