# OWeb OpenClaw Gap Closures

Portable TypeScript modules that close the highest-priority gaps identified in the [OpenClaw capability audit](../docs/OPENCLAW_CAPABILITY_AUDIT.md).

**Design:** No OpenClaw plugin runtime. Thin webhook/MCP layers that wire into OWeb's existing chat runner and `ao_entities` memory graph.

## Modules

| Module | Path | Purpose |
|--------|------|---------|
| **Telegram channel** | `src/channels/telegram-channel.server.ts` | Bot API webhook ingress → chat thread; outbound replies |
| **Memory MCP** | `src/mcp/memory-tools.server.ts` | `memory_search` / `memory_remember` over memory store |
| **Twilio Voice MCP** | `src/mcp/twilio-voice.server.ts` | `initiate_call` / `end_call` PSTN |
| **Org webhooks** | `src/webhooks/org-webhooks.server.ts` | Signed per-org URLs → chat runner |
| **Marketplace** | `src/marketplace/composio-additions.ts` | Surface `telegram` + `spotify` Composio toolkits |

## Telegram setup

1. Create a bot via [@BotFather](https://t.me/BotFather) and store the token in OWeb Vault / org channel config.
2. Generate a webhook secret (`openssl rand -hex 32`).
3. Register webhook:

```ts
import { setTelegramWebhook, buildTelegramWebhookPath } from "@oweb/gap-closures";

await setTelegramWebhook(botToken, {
  url: `https://oweb.one${buildTelegramWebhookPath(orgId)}`,
  secret_token: webhookSecret,
  allowed_updates: ["message"],
});
```

4. Mount `handleTelegramWebhook` on your API router with org config lookup.

Uses native `fetch` to the Telegram Bot API (no grammy/OpenClaw deps).

## Memory tools

Wire `createMemoryMcpTools()` to your `memory-graph.server.ts` adapter:

```ts
const store: MemoryStore = {
  search: (p) => memoryGraphSearch(p),
  remember: (p) => memoryGraphRemember(p),
};
export const memoryTools = createMemoryMcpTools(store);
```

## Org webhooks

Clients sign requests with HMAC-SHA256:

```
X-OWeb-Timestamp: <unix-seconds>
X-OWeb-Signature: sha256=<hmac(secret, timestamp + "." + body)>
```

Body: `{ "message": "...", "threadKey": "optional" }`

## Integration checklist (OWeb)

- [ ] Copy `src/channels/telegram-channel.server.ts` → `src/lib/channels/`
- [ ] Add API route `src/routes/api/channels/telegram/webhook.ts`
- [ ] Register memory MCP tools in custom MCP merge
- [ ] Register Twilio Voice MCP (requires `TWILIO_*` env or Vault)
- [ ] Extend `platform-webhooks.server.ts` with `org-webhooks` handler
- [ ] Add `telegram` + `spotify` to `composio-marketplace.ts`
- [ ] Channels UI: Telegram connect flow (token + webhook status)

## Tests

```bash
cd oweb-gap-closures && npm install && npm test
```
