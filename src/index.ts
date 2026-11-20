#!/usr/bin/env node
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { CliUsageError, HELP_TEXT, VERSION, parseCliArgs, type CliOptions } from "./cli.js";
import { MercadoPagoClient } from "./mp/client.js";
import { createServer } from "./server.js";

async function main(): Promise<void> {
  let options: CliOptions;
  try {
    options = parseCliArgs(process.argv.slice(2), process.env);
  } catch (error) {
    if (error instanceof CliUsageError) {
      process.stderr.write(`${error.message}\n\n${HELP_TEXT}`);
      process.exitCode = 2;
      return;
    }
    throw error;
  }

  // --help and --version are the only paths that may write to stdout;
  // once the transport connects, stdout carries JSON-RPC frames only.
  if (options.help) {
    process.stdout.write(HELP_TEXT);
    return;
  }
  if (options.version) {
    process.stdout.write(`${VERSION}\n`);
    return;
  }

  const client = new MercadoPagoClient({ accessToken: process.env["MP_ACCESS_TOKEN"] });
  const server = createServer({
    client,
    allowWrites: options.allowWrites,
    webhookSecret: process.env["MP_WEBHOOK_SECRET"],
  });
  await server.connect(new StdioServerTransport());
  console.error(
    `mercadopago-mcp ${VERSION} on stdio (${options.allowWrites ? "writes enabled" : "read-only"})`,
  );
}

main().catch((error: unknown) => {
  console.error("mercadopago-mcp failed to start:", error instanceof Error ? error.message : error);
  process.exit(1);
});
