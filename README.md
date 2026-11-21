<div align="center">

# mercadopago-mcp

MCP server to inspect Mercado Pago payments, orders, preferences, and webhook signatures from your AI client.

[![npm version](https://img.shields.io/npm/v/mercadopago-mcp.svg)](https://www.npmjs.com/package/mercadopago-mcp)
[![Glama MCP server](https://glama.ai/mcp/servers/DevModee/mercadopago-mcp/badges/score.svg)](https://glama.ai/mcp/servers/DevModee/mercadopago-mcp)
[![License: MIT](https://img.shields.io/badge/license-MIT-blue.svg)](LICENSE)
[![TypeScript](https://img.shields.io/badge/TypeScript-strict-3178C6.svg)](tsconfig.json)
[![Read-only by default](https://img.shields.io/badge/writes-off%20by%20default-2ea44f.svg)](#security-model)

</div>

Ask your assistant why a payment was rejected, what a merchant order contains, or whether a webhook signature is valid, without leaving the editor. Nothing can change state on your account unless you opt in: `--allow-writes` adds preference creation, and refunds need their own `--allow-refunds`.

Built from running Mercado Pago in production for a web and Android marketplace, where most of the debugging time went into payment lookups, order reconciliation, and webhook signatures.

## Quick start

```sh
MP_ACCESS_TOKEN=APP_USR-your-token npx -y mercadopago-mcp
```

The server speaks MCP over stdio, so you normally let your client start it with one of the configs below. Run `npx -y mercadopago-mcp --help` to see all options.

## Requirements

- Node.js 20 or newer
- A Mercado Pago access token (`APP_USR-...` for production, or a test user's token). Get it from [Your integrations](https://www.mercadopago.com/developers/panel/app) > your app > Production credentials or Test credentials.

## Setup

The server runs over stdio through `npx`. Every client config below passes the token through `env`; it never needs to be in a file inside your repo.

### Claude Desktop

Edit `claude_desktop_config.json` (Settings > Developer > Edit Config):

```json
{
  "mcpServers": {
    "mercadopago": {
      "command": "npx",
      "args": ["-y", "mercadopago-mcp"],
      "env": {
        "MP_ACCESS_TOKEN": "APP_USR-your-token",
        "MP_WEBHOOK_SECRET": "your-webhook-secret"
      }
    }
  }
}
```

Restart Claude Desktop after saving.

### Cursor

Add to `~/.cursor/mcp.json` (all projects) or `.cursor/mcp.json` (one project):

```json
{
  "mcpServers": {
    "mercadopago": {
      "command": "npx",
      "args": ["-y", "mercadopago-mcp"],
      "env": {
        "MP_ACCESS_TOKEN": "APP_USR-your-token"
      }
    }
  }
}
```

### Claude Code

```sh
claude mcp add mercadopago --scope user \
  -e MP_ACCESS_TOKEN=APP_USR-your-token \
  -e MP_WEBHOOK_SECRET=your-webhook-secret \
  -- npx -y mercadopago-mcp
```

Check it with `claude mcp list`. To share the server with a team, commit a project-scoped `.mcp.json` instead and keep the token in each developer's shell environment:

```json
{
  "mcpServers": {
    "mercadopago": {
      "command": "npx",
      "args": ["-y", "mercadopago-mcp"],
      "env": {
        "MP_ACCESS_TOKEN": "${MP_ACCESS_TOKEN}"
      }
    }
  }
}
```

### Enabling write tools

Each gate is independent. Add the flag to `args`, or set the env var in `env`:

| Flag | Env var | Registers |
| --- | --- | --- |
| `--allow-writes` | `MP_ALLOW_WRITES=true` | `create_preference` |
| `--allow-refunds` | `MP_ALLOW_REFUNDS=true` | `refund_payment` |

```json
"args": ["-y", "mercadopago-mcp", "--allow-writes", "--allow-refunds"]
```

Use a test user's token while you try this out.

**Upgrading from 0.1.0:** `--allow-writes` used to register `refund_payment` too. From 0.2.0 it only registers `create_preference`; add `--allow-refunds` if you still want refunds.

## Tools

### Read-only (always registered)

| Tool | What it does |
| --- | --- |
| `get_payment` | Full payment by ID: status, `status_detail`, amounts, payer, fees, refunds. |
| `search_payments` | Filter by `status`, `external_reference`, `payer_email`, and a date range (`begin_date`/`end_date` as ISO 8601 or `NOW-7DAYS`, `range` picks the date field). Paged with `limit` (max 100) and `offset`. Returns compact summaries unless `compact: false`. |
| `get_merchant_order` | Merchant order by ID with items, `order_status`, paid vs total, and attached payments. |
| `get_preference` | Checkout Pro preference by ID: items, `back_urls`, `notification_url`, expiration, `init_point`. |
| `list_payment_methods` | Payment methods for the account or a `site_id` (MLA, MLB, MLM, ...), optionally filtered by `payment_type_id`. |
| `verify_webhook_signature` | Checks an `x-signature` header locally with HMAC-SHA256. Works offline and without `MP_ACCESS_TOKEN`. |

### Write-gated

| Tool | Gate | What it does |
| --- | --- | --- |
| `create_preference` | `--allow-writes` / `MP_ALLOW_WRITES=true` | Creates a Checkout Pro preference and returns `id` and `init_point`. No money moves until a buyer pays. |
| `refund_payment` | `--allow-refunds` / `MP_ALLOW_REFUNDS=true` | Refunds a payment. Requires either `amount` (partial) or `full_refund: true`; a call with neither is rejected so a missing amount never means "refund everything". |

Both tools accept an optional `idempotency_key`. Reuse it when retrying so Mercado Pago does not apply the operation twice. Without it, every call gets a fresh key.

## Verifying webhooks

Pass the raw values from the incoming request:

- `x_signature`: the `x-signature` header, e.g. `ts=1742505638683,v1=0163c3...`
- `x_request_id`: the `x-request-id` header
- `data_id`: `data.id` from the notification URL query string, not from the JSON body
- `secret`: optional; defaults to `MP_WEBHOOK_SECRET`. Prefer the env var so the secret stays out of the chat.
- `max_age_seconds`: optional replay window. Leave it out when checking old notifications.

The result includes `valid`, a `reason`, and the exact `manifest` that was signed (`id:<data.id>;request-id:<x-request-id>;ts:<ts>;`). When a signature fails, compare that manifest with what your backend builds: the usual causes are reading `data.id` from the body instead of the query string, or not lowercasing alphanumeric IDs.

## Example prompts

- "Why was payment 1234567890 rejected?"
- "List approved payments from the last 7 days for external_reference order-981."
- "Merchant order 987654321 says paid but my order is pending. What payments does it have?"
- "Verify this webhook: x-signature `ts=...,v1=...`, x-request-id `...`, data.id `...`."

## Security model

- **Read-only by default.** With no flags, no tool that changes state is registered, so the model cannot call one.
- **Refunds gated separately.** `--allow-writes` enables `create_preference` only. `refund_payment` moves money out of the account and needs `--allow-refunds` or `MP_ALLOW_REFUNDS=true` on its own, so enabling checkout links never enables refunds by accident.
- **Token loaded lazily.** The server starts without `MP_ACCESS_TOKEN`; API-backed tools return a clear error until it is set. `--help`, `--version`, and webhook verification never need it.
- **No secrets in output.** The access token is stripped from any error text returned by the API, and webhook results never echo the secret.
- **Validated inputs.** Every tool argument is checked with zod before any request is made. IDs are path-encoded, and URLs passed to `create_preference` must be HTTPS.
- **Stdout is protocol-only.** Diagnostics go to stderr, so nothing corrupts the JSON-RPC stream.
- **15 second timeout** on every API call.
- **Keep the token scoped to this server.** Pass `MP_ACCESS_TOKEN` only in this server's MCP `env` block rather than your global shell, and avoid pairing it with a generic HTTP or `curl` tool that could bypass disabled write or refund gates.

Use a token with the smallest scope that covers what you need, and a test user's token for anything involving writes.

## Environment variables

| Variable | Purpose |
| --- | --- |
| `MP_ACCESS_TOKEN` | Mercado Pago access token. Required by every tool except `verify_webhook_signature`. |
| `MP_ALLOW_WRITES` | `true` registers `create_preference`. Same as `--allow-writes`. |
| `MP_ALLOW_REFUNDS` | `true` registers `refund_payment`. Same as `--allow-refunds`. |
| `MP_WEBHOOK_SECRET` | Default secret for `verify_webhook_signature`. |

## Development

```sh
git clone https://github.com/DevModee/mercadopago-mcp.git
cd mercadopago-mcp
npm install
npm run typecheck
npm run build
npm test
node dist/index.js --help
```

Tests use `node --test` with a mocked `fetch`; they never call the real API.

To try a local build in a client, point `command` at `node` and `args` at the absolute path of `dist/index.js`.

## License

[MIT](LICENSE) © [Matías Sánchez González](https://www.matiasgs.com)
