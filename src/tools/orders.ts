import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import type { MercadoPagoClient } from "../mp/client.js";
import type { MerchantOrder, Preference } from "../mp/types.js";
import { numericId, runTool } from "./shared.js";

export const preferenceId = z
  .string()
  .regex(/^[A-Za-z0-9_-]{1,128}$/, "Preference ID may only contain letters, digits, '-' and '_'")
  .describe("Checkout Pro preference ID, e.g. 123456789-0a1b2c3d-...");

export function registerOrderTools(server: McpServer, client: MercadoPagoClient): void {
  server.registerTool(
    "get_merchant_order",
    {
      title: "Get merchant order",
      description:
        "Fetch a merchant order by ID: order_status, total vs paid amount, items, and every payment attached to it. Useful when a webhook arrives with topic=merchant_order.",
      inputSchema: { merchant_order_id: numericId("Merchant order ID") },
      annotations: { readOnlyHint: true, openWorldHint: true },
    },
    ({ merchant_order_id }) =>
      runTool(() =>
        client.get<MerchantOrder>(`/merchant_orders/${encodeURIComponent(String(merchant_order_id))}`),
      ),
  );

  server.registerTool(
    "get_preference",
    {
      title: "Get preference",
      description:
        "Fetch a Checkout Pro preference by ID: items, back_urls, notification_url, external_reference, expiration, and init_point.",
      inputSchema: { preference_id: preferenceId },
      annotations: { readOnlyHint: true, openWorldHint: true },
    },
    ({ preference_id }) =>
      runTool(() =>
        client.get<Preference>(`/checkout/preferences/${encodeURIComponent(preference_id)}`),
      ),
  );
}
