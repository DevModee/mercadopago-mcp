import { createHmac, timingSafeEqual } from "node:crypto";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { ToolInputError, runTool } from "./shared.js";

export interface VerifyWebhookParams {
  xSignature: string;
  xRequestId?: string | undefined;
  dataId?: string | undefined;
  secret: string;
  maxAgeSeconds?: number | undefined;
  now?: number | undefined;
}

export interface VerifyWebhookResult {
  valid: boolean;
  reason: string;
  manifest: string | null;
  ts: string | null;
  age_seconds: number | null;
}

export function parseSignatureHeader(header: string): { ts?: string; v1?: string } {
  const parts: { ts?: string; v1?: string } = {};
  for (const segment of header.split(",")) {
    const eq = segment.indexOf("=");
    if (eq === -1) continue;
    const key = segment.slice(0, eq).trim();
    const value = segment.slice(eq + 1).trim();
    if (key === "ts" || key === "v1") parts[key] = value;
  }
  return parts;
}

// Mercado Pago signs "id:<data.id>;request-id:<x-request-id>;ts:<ts>;". Parts whose
// value is absent from the notification are dropped, and alphanumeric data.id values
// must be lowercased before signing.
export function buildManifest(ts: string, dataId?: string, requestId?: string): string {
  let manifest = "";
  if (dataId !== undefined && dataId !== "") manifest += `id:${dataId.toLowerCase()};`;
  if (requestId !== undefined && requestId !== "") manifest += `request-id:${requestId};`;
  return `${manifest}ts:${ts};`;
}

export function verifyWebhookSignature(params: VerifyWebhookParams): VerifyWebhookResult {
  const { ts, v1 } = parseSignatureHeader(params.xSignature);
  const fail = (reason: string, manifest: string | null = null, age: number | null = null) => ({
    valid: false,
    reason,
    manifest,
    ts: ts ?? null,
    age_seconds: age,
  });

  if (ts === undefined || !/^\d+$/.test(ts)) return fail("x-signature is missing a numeric ts part");
  if (v1 === undefined || !/^[0-9a-fA-F]{64}$/.test(v1)) {
    return fail("x-signature is missing a 64-char hex v1 part");
  }

  const manifest = buildManifest(ts, params.dataId?.trim(), params.xRequestId?.trim());

  // ts is documented in seconds but observed in milliseconds; accept both.
  const tsMs = ts.length >= 13 ? Number(ts) : Number(ts) * 1000;
  const age = Math.round(((params.now ?? Date.now()) - tsMs) / 1000);

  const expected = createHmac("sha256", params.secret).update(manifest).digest();
  const received = Buffer.from(v1, "hex");
  if (!timingSafeEqual(expected, received)) {
    return fail("signature mismatch: wrong secret, or data.id / x-request-id differ from the notification", manifest, age);
  }
  if (params.maxAgeSeconds !== undefined && Math.abs(age) > params.maxAgeSeconds) {
    return fail(`signature is valid but ts is ${age}s old (max_age_seconds=${params.maxAgeSeconds})`, manifest, age);
  }
  return { valid: true, reason: "signature matches", manifest, ts, age_seconds: age };
}

export const verifyWebhookShape = {
  x_signature: z
    .string()
    .min(1)
    .max(512)
    .describe('Raw x-signature header, e.g. "ts=1742505638683,v1=<hex>"'),
  x_request_id: z.string().max(256).optional().describe("Raw x-request-id header"),
  data_id: z
    .string()
    .max(256)
    .optional()
    .describe("data.id from the notification URL query string (not the JSON body)"),
  secret: z
    .string()
    .min(1)
    .optional()
    .describe("Webhook secret from Your integrations. Omit to use MP_WEBHOOK_SECRET from the server env"),
  max_age_seconds: z
    .number()
    .int()
    .positive()
    .optional()
    .describe("Reject signatures older than this. Omit when replaying old notifications"),
};

export function registerWebhookTools(server: McpServer, defaultSecret: string | undefined): void {
  server.registerTool(
    "verify_webhook_signature",
    {
      title: "Verify webhook signature",
      description:
        "Verify a Mercado Pago webhook x-signature locally with HMAC-SHA256. Runs offline and needs no access token. Returns whether it is valid and the signed manifest for debugging.",
      inputSchema: verifyWebhookShape,
      annotations: { readOnlyHint: true, openWorldHint: false },
    },
    (input) =>
      runTool(() => {
        const secret = input.secret ?? defaultSecret;
        if (secret === undefined || secret === "") {
          throw new ToolInputError("No webhook secret: pass `secret` or set MP_WEBHOOK_SECRET in the server env.");
        }
        return verifyWebhookSignature({
          xSignature: input.x_signature,
          xRequestId: input.x_request_id,
          dataId: input.data_id,
          secret,
          maxAgeSeconds: input.max_age_seconds,
        });
      }),
  );
}
