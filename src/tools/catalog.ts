import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import type { MercadoPagoClient } from "../mp/client.js";
import type { PaymentMethod } from "../mp/types.js";
import { runTool } from "./shared.js";

const SITE_IDS = ["MLA", "MLB", "MLC", "MLM", "MLU", "MCO", "MPE"] as const;

const PAYMENT_TYPES = [
  "account_money",
  "ticket",
  "bank_transfer",
  "atm",
  "credit_card",
  "debit_card",
  "prepaid_card",
  "digital_currency",
  "digital_wallet",
  "voucher_card",
  "crypto_transfer",
] as const;

export const listPaymentMethodsShape = {
  site_id: z
    .enum(SITE_IDS)
    .optional()
    .describe("Country site (MLA Argentina, MLB Brazil, MLM Mexico, ...). Defaults to the token's site"),
  payment_type_id: z.enum(PAYMENT_TYPES).optional().describe("Only return methods of this type"),
  include_inactive: z.boolean().default(false).describe("Include methods whose status is not active"),
  compact: z.boolean().default(true).describe("Return id, name, type, status, and amount limits only"),
};

export type ListPaymentMethodsInput = z.infer<z.ZodObject<typeof listPaymentMethodsShape>>;

export function filterPaymentMethods(
  methods: readonly PaymentMethod[],
  input: ListPaymentMethodsInput,
): Array<PaymentMethod | CompactPaymentMethod> {
  return methods
    .filter((m) => input.include_inactive || m.status === "active")
    .filter((m) => input.payment_type_id === undefined || m.payment_type_id === input.payment_type_id)
    .map((m) => (input.compact ? compactPaymentMethod(m) : m));
}

export interface CompactPaymentMethod {
  id: string;
  name: string;
  payment_type_id: string;
  status: string;
  min_allowed_amount: number | null;
  max_allowed_amount: number | null;
}

function compactPaymentMethod(m: PaymentMethod): CompactPaymentMethod {
  return {
    id: m.id,
    name: m.name,
    payment_type_id: m.payment_type_id,
    status: m.status,
    min_allowed_amount: m.min_allowed_amount ?? null,
    max_allowed_amount: m.max_allowed_amount ?? null,
  };
}

export function registerCatalogTools(server: McpServer, client: MercadoPagoClient): void {
  server.registerTool(
    "list_payment_methods",
    {
      title: "List payment methods",
      description:
        "List payment methods available to the account or to a country site, optionally filtered by payment type.",
      inputSchema: listPaymentMethodsShape,
      annotations: { readOnlyHint: true, openWorldHint: true },
    },
    (input) =>
      runTool(async () => {
        const path = input.site_id ? `/sites/${input.site_id}/payment_methods` : "/v1/payment_methods";
        const methods = await client.get<PaymentMethod[]>(path);
        return filterPaymentMethods(methods, input);
      }),
  );
}
