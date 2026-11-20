import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import type { MercadoPagoClient } from "../mp/client.js";
import type { Payment, PaymentSearchResponse } from "../mp/types.js";
import { ToolInputError, numericId, runTool } from "./shared.js";

const PAYMENT_STATUSES = [
  "pending",
  "approved",
  "authorized",
  "in_process",
  "in_mediation",
  "rejected",
  "cancelled",
  "refunded",
  "charged_back",
] as const;

const DATE_FIELDS = ["date_created", "date_approved", "date_last_updated", "money_release_date"] as const;

const RELATIVE_DATE = /^NOW(-\d+(MINUTES|HOURS|DAYS|WEEKS|MONTHS|YEARS))?$/;
const DATE_ONLY = /^\d{4}-\d{2}-\d{2}$/;

const dateInput = z
  .string()
  .refine((value) => RELATIVE_DATE.test(value) || !Number.isNaN(Date.parse(value)), {
    message: "Use ISO 8601 (2026-01-31 or 2026-01-31T10:00:00-03:00) or NOW-<n>DAYS",
  });

export const searchPaymentsShape = {
  status: z.enum(PAYMENT_STATUSES).optional().describe("Filter by payment status"),
  external_reference: z
    .string()
    .min(1)
    .max(256)
    .optional()
    .describe("Your own order reference sent when the payment was created"),
  payer_email: z.email().optional().describe("Filter by payer email"),
  range: z
    .enum(DATE_FIELDS)
    .optional()
    .describe("Date field that begin_date/end_date apply to. Defaults to date_created"),
  begin_date: dateInput
    .optional()
    .describe("Start of the range: ISO 8601 or relative like NOW-7DAYS. Date-only values use 00:00 UTC"),
  end_date: dateInput
    .optional()
    .describe("End of the range: ISO 8601 or NOW. Defaults to NOW when begin_date is set"),
  sort: z.enum(DATE_FIELDS).default("date_created").describe("Sort field"),
  criteria: z.enum(["asc", "desc"]).default("desc").describe("Sort direction"),
  limit: z.number().int().min(1).max(100).default(30).describe("Page size (1-100)"),
  offset: z.number().int().min(0).max(10_000).default(0).describe("Results to skip"),
  compact: z
    .boolean()
    .default(true)
    .describe("Return a short summary per payment instead of the full payload"),
};

export type SearchPaymentsInput = z.infer<z.ZodObject<typeof searchPaymentsShape>>;

export function buildPaymentSearchQuery(input: SearchPaymentsInput): Record<string, string | number> {
  const query: Record<string, string | number> = {
    sort: input.sort,
    criteria: input.criteria,
    limit: input.limit,
    offset: input.offset,
  };
  if (input.status !== undefined) query["status"] = input.status;
  if (input.external_reference !== undefined) query["external_reference"] = input.external_reference;
  if (input.payer_email !== undefined) query["payer.email"] = input.payer_email;

  if (input.begin_date === undefined && input.end_date !== undefined) {
    throw new ToolInputError("end_date requires begin_date");
  }
  if (input.begin_date === undefined && input.range !== undefined) {
    throw new ToolInputError("range requires begin_date");
  }
  if (input.begin_date !== undefined) {
    query["range"] = input.range ?? "date_created";
    query["begin_date"] = normalizeDate(input.begin_date, "start");
    query["end_date"] = normalizeDate(input.end_date ?? "NOW", "end");
  }
  return query;
}

function normalizeDate(value: string, edge: "start" | "end"): string {
  if (RELATIVE_DATE.test(value)) return value;
  if (DATE_ONLY.test(value)) {
    return `${value}T${edge === "start" ? "00:00:00.000" : "23:59:59.999"}Z`;
  }
  return value;
}

export interface PaymentSummary {
  id: number;
  status: string;
  status_detail: string | null;
  amount: number;
  refunded: number | null;
  currency: string;
  date_created: string;
  date_approved: string | null;
  external_reference: string | null;
  payer_email: string | null;
  payment_method: string | null;
  payment_type: string | null;
  live_mode: boolean | null;
}

export function summarizePayment(payment: Payment): PaymentSummary {
  return {
    id: payment.id,
    status: payment.status,
    status_detail: payment.status_detail ?? null,
    amount: payment.transaction_amount,
    refunded: payment.transaction_amount_refunded ?? null,
    currency: payment.currency_id,
    date_created: payment.date_created,
    date_approved: payment.date_approved ?? null,
    external_reference: payment.external_reference ?? null,
    payer_email: payment.payer?.email ?? null,
    payment_method: payment.payment_method_id ?? null,
    payment_type: payment.payment_type_id ?? null,
    live_mode: payment.live_mode ?? null,
  };
}

export function registerPaymentTools(server: McpServer, client: MercadoPagoClient): void {
  server.registerTool(
    "get_payment",
    {
      title: "Get payment",
      description:
        "Fetch one Mercado Pago payment by ID, including status, status_detail, amounts, payer, fees, and refunds.",
      inputSchema: { payment_id: numericId("Payment ID") },
      annotations: { readOnlyHint: true, openWorldHint: true },
    },
    ({ payment_id }) =>
      runTool(() => client.get<Payment>(`/v1/payments/${encodeURIComponent(String(payment_id))}`)),
  );

  server.registerTool(
    "search_payments",
    {
      title: "Search payments",
      description:
        "Search payments on the account by status, external_reference, payer email, and date range. Returns paging info and compact summaries unless compact=false.",
      inputSchema: searchPaymentsShape,
      annotations: { readOnlyHint: true, openWorldHint: true },
    },
    (input) =>
      runTool(async () => {
        const response = await client.get<PaymentSearchResponse>(
          "/v1/payments/search",
          buildPaymentSearchQuery(input),
        );
        return {
          paging: response.paging,
          results: input.compact ? response.results.map(summarizePayment) : response.results,
        };
      }),
  );
}
