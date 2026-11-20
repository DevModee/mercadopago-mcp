import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { VERSION } from "./cli.js";

export interface ServerOptions {
  allowWrites: boolean;
}

export function createServer(_options: ServerOptions): McpServer {
  return new McpServer({ name: "mercadopago-mcp", version: VERSION });
}
