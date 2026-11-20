import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import { z } from "zod";
import {
  MercadoPagoApiError,
  MercadoPagoNetworkError,
  MissingAccessTokenError,
} from "../mp/client.js";

export class ToolInputError extends Error {
  override name = "ToolInputError";
}

export const numericId = (what: string) =>
  z
    .union([z.string().regex(/^\d+$/, `${what} must be numeric`), z.number().int().positive()])
    .describe(`${what} (numeric, as string or number)`);

export function jsonResult(data: unknown): CallToolResult {
  return { content: [{ type: "text", text: JSON.stringify(data, null, 2) }] };
}

export function errorResult(error: unknown): CallToolResult {
  return { isError: true, content: [{ type: "text", text: formatError(error) }] };
}

export async function runTool(fn: () => Promise<unknown> | unknown): Promise<CallToolResult> {
  try {
    return jsonResult(await fn());
  } catch (error) {
    return errorResult(error);
  }
}

export function formatError(error: unknown): string {
  if (error instanceof MercadoPagoApiError) {
    const lines = [
      `Mercado Pago API error ${error.status}${error.code ? ` (${error.code})` : ""}: ${error.message}`,
    ];
    for (const cause of error.causes) {
      lines.push(`- cause ${cause.code || "?"}: ${cause.description || "no description"}`);
    }
    if (error.requestId) lines.push(`x-request-id: ${error.requestId}`);
    return lines.join("\n");
  }
  if (
    error instanceof MissingAccessTokenError ||
    error instanceof MercadoPagoNetworkError ||
    error instanceof ToolInputError
  ) {
    return error.message;
  }
  return `Unexpected error: ${error instanceof Error ? error.message : String(error)}`;
}
