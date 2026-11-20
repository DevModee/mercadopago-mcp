import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { VERSION } from "./cli.js";
import type { MercadoPagoClient } from "./mp/client.js";
import { registerCatalogTools } from "./tools/catalog.js";
import { registerOrderTools } from "./tools/orders.js";
import { registerPaymentTools } from "./tools/payments.js";
import { registerWebhookTools } from "./tools/webhooks.js";
import { registerWriteTools } from "./tools/writes.js";

export interface ServerOptions {
  client: MercadoPagoClient;
  allowWrites: boolean;
  webhookSecret?: string | undefined;
}

export function createServer(options: ServerOptions): McpServer {
  const server = new McpServer({ name: "mercadopago-mcp", version: VERSION });
  registerPaymentTools(server, options.client);
  registerOrderTools(server, options.client);
  registerCatalogTools(server, options.client);
  registerWebhookTools(server, options.webhookSecret);
  if (options.allowWrites) registerWriteTools(server, options.client);
  return server;
}
