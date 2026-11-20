import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const pkg = require("../package.json") as { version: string };

export const VERSION: string = pkg.version;

export const HELP_TEXT = `mercadopago-mcp ${VERSION}

MCP server for Mercado Pago. Speaks JSON-RPC over stdio.

Usage:
  mercadopago-mcp [--allow-writes]

Options:
  --allow-writes   Register create_preference and refund_payment.
                   Same as MP_ALLOW_WRITES=true.
  -h, --help       Show this help and exit.
  -v, --version    Print the version and exit.

Environment:
  MP_ACCESS_TOKEN     Mercado Pago access token. Required by API-backed tools.
  MP_ALLOW_WRITES     Set to "true" to enable write tools.
  MP_WEBHOOK_SECRET   Default secret for verify_webhook_signature.
`;

export interface CliOptions {
  help: boolean;
  version: boolean;
  allowWrites: boolean;
}

export class CliUsageError extends Error {
  override name = "CliUsageError";
}

export function parseCliArgs(
  argv: readonly string[],
  env: Readonly<Record<string, string | undefined>>,
): CliOptions {
  const options: CliOptions = {
    help: false,
    version: false,
    allowWrites: isTruthy(env["MP_ALLOW_WRITES"]),
  };

  for (const arg of argv) {
    switch (arg) {
      case "-h":
      case "--help":
        options.help = true;
        break;
      case "-v":
      case "--version":
        options.version = true;
        break;
      case "--allow-writes":
        options.allowWrites = true;
        break;
      default:
        throw new CliUsageError(`Unknown argument: ${arg}`);
    }
  }

  return options;
}

function isTruthy(value: string | undefined): boolean {
  if (value === undefined) return false;
  return ["1", "true", "yes", "on"].includes(value.trim().toLowerCase());
}
