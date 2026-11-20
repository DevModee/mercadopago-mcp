import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { VERSION } from "./cli.js";
import type { MercadoPagoClient } from "./mp/client.js";
import { registerPaymentTools } from "./tools/payments.js";

export interface ServerOptions {
  client: MercadoPagoClient;
  allowWrites: boolean;
}

export function createServer(options: ServerOptions): McpServer {
  const server = new McpServer({ name: "mercadopago-mcp", version: VERSION });
  registerPaymentTools(server, options.client);
  return server;
}
