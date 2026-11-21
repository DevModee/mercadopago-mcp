import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import type { MercadoPagoClient } from "../mp/client.js";
import type { Preference, PreferenceCreateRequest, Refund } from "../mp/types.js";
import { ToolInputError, numericId, runTool } from "./shared.js";

const httpsUrl = z.url({ protocol: /^https$/ });

const idempotencyKey = z
  .string()
  .min(8)
  .max(64)
  .regex(/^[A-Za-z0-9_-]+$/)
  .optional()
  .describe("Reuse the same key when retrying so Mercado Pago does not apply the operation twice");

export const createPreferenceShape = {
  items: z
    .array(
      z.object({
        title: z.string().min(1).max(256),
        quantity: z.number().int().min(1),
        unit_price: z.number().positive(),
        currency_id: z
          .string()
          .regex(/^[A-Z]{3}$/)
          .optional()
          .describe("ISO 4217 code, e.g. ARS, BRL, MXN. Defaults to the account currency"),
        id: z.string().max(256).optional(),
        description: z.string().max(600).optional(),
      }),
    )
    .min(1)
    .max(100)
    .describe("Line items to charge"),
  external_reference: z.string().max(256).optional().describe("Your order ID, echoed back on payments"),
  notification_url: httpsUrl.optional().describe("HTTPS webhook URL for this preference"),
  back_urls: z
    .object({
      success: httpsUrl.optional(),
      pending: httpsUrl.optional(),
      failure: httpsUrl.optional(),
    })
    .optional()
    .describe("Where the buyer returns after checkout"),
  auto_return: z
    .enum(["approved", "all"])
    .optional()
    .describe("Redirect automatically after payment. Requires back_urls.success"),
  payer_email: z.email().optional().describe("Prefill the payer email"),
  statement_descriptor: z.string().max(22).optional().describe("Text shown on the card statement"),
  expiration_date_to: z
    .iso.datetime({ offset: true })
    .optional()
    .describe("Checkout link stops working after this ISO 8601 datetime"),
  metadata: z
    .record(z.string(), z.union([z.string(), z.number(), z.boolean()]))
    .optional()
    .describe("Flat key/value metadata copied to resulting payments"),
  idempotency_key: idempotencyKey,
};

export type CreatePreferenceInput = z.infer<z.ZodObject<typeof createPreferenceShape>>;

export function buildPreferenceRequest(input: CreatePreferenceInput): PreferenceCreateRequest {
  if (input.auto_return !== undefined && input.back_urls?.success === undefined) {
    throw new ToolInputError("auto_return requires back_urls.success");
  }
  const body: PreferenceCreateRequest = {
    items: input.items.map((item) => ({
      title: item.title,
      quantity: item.quantity,
      unit_price: item.unit_price,
      ...(item.currency_id !== undefined && { currency_id: item.currency_id }),
      ...(item.id !== undefined && { id: item.id }),
      ...(item.description !== undefined && { description: item.description }),
    })),
  };
  if (input.external_reference !== undefined) body.external_reference = input.external_reference;
  if (input.notification_url !== undefined) body.notification_url = input.notification_url;
  if (input.back_urls !== undefined) {
    body.back_urls = {
      ...(input.back_urls.success !== undefined && { success: input.back_urls.success }),
      ...(input.back_urls.pending !== undefined && { pending: input.back_urls.pending }),
      ...(input.back_urls.failure !== undefined && { failure: input.back_urls.failure }),
    };
  }
  if (input.auto_return !== undefined) body.auto_return = input.auto_return;
  if (input.payer_email !== undefined) body.payer = { email: input.payer_email };
  if (input.statement_descriptor !== undefined) body.statement_descriptor = input.statement_descriptor;
  if (input.expiration_date_to !== undefined) {
    body.expires = true;
    body.expiration_date_to = input.expiration_date_to;
  }
  if (input.metadata !== undefined) body.metadata = input.metadata;
  return body;
}

export const refundPaymentShape = {
  payment_id: numericId("Payment ID to refund"),
  amount: z.number().positive().optional().describe("Partial refund amount in the payment currency"),
  full_refund: z
    .boolean()
    .optional()
    .describe("Set true to refund the whole remaining amount. Required when amount is omitted"),
  idempotency_key: idempotencyKey,
};

export type RefundPaymentInput = z.infer<z.ZodObject<typeof refundPaymentShape>>;

// A refund without an amount refunds everything, so require the caller to say so
// explicitly instead of treating a missing amount as consent.
export function buildRefundRequest(input: RefundPaymentInput): { amount?: number } {
  if (input.amount !== undefined && input.full_refund === true) {
    throw new ToolInputError("Pass either amount or full_refund=true, not both");
  }
  if (input.amount !== undefined) return { amount: input.amount };
  if (input.full_refund === true) return {};
  throw new ToolInputError("Pass amount for a partial refund or full_refund=true for a full refund");
}

export function registerPreferenceTools(server: McpServer, client: MercadoPagoClient): void {
  server.registerTool(
    "create_preference",
    {
      title: "Create Checkout Pro preference",
      description:
        "Create a Checkout Pro preference and return its id and init_point checkout link. Creates state on the account; no money moves until a buyer pays.",
      inputSchema: createPreferenceShape,
      annotations: { readOnlyHint: false, destructiveHint: false, openWorldHint: true },
    },
    (input) =>
      runTool(async () => {
        const preference = await client.post<Preference>(
          "/checkout/preferences",
          buildPreferenceRequest(input),
          input.idempotency_key !== undefined ? { idempotencyKey: input.idempotency_key } : undefined,
        );
        return {
          id: preference.id,
          init_point: preference.init_point,
          sandbox_init_point: preference.sandbox_init_point ?? null,
          external_reference: preference.external_reference ?? null,
          date_created: preference.date_created ?? null,
        };
      }),
  );
}

// Refunds move money out of the account, so they sit behind their own flag
// instead of riding along with preference creation.
export function registerRefundTools(server: McpServer, client: MercadoPagoClient): void {
  server.registerTool(
    "refund_payment",
    {
      title: "Refund payment",
      description:
        "Refund a payment fully (full_refund=true) or partially (amount). Moves money back to the buyer and cannot be undone. Confirm with the user before calling.",
      inputSchema: refundPaymentShape,
      annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: false, openWorldHint: true },
    },
    (input) =>
      runTool(() =>
        client.post<Refund>(
          `/v1/payments/${encodeURIComponent(String(input.payment_id))}/refunds`,
          buildRefundRequest(input),
          input.idempotency_key !== undefined ? { idempotencyKey: input.idempotency_key } : undefined,
        ),
      ),
  );
}
