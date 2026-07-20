# OWeb OpenClaw Gap Closures

Portable TypeScript modules that close OpenClaw capability gaps for OWeb — copy OpenClaw patterns where they fit, custom lightweight implementations everywhere else.

**Design:** No OpenClaw plugin runtime. Thin webhook/MCP/scheduler layers wired to OWeb's chat runner and `ao_entities` memory graph.

## Modules

| Module | Path | Purpose |
|--------|------|---------|
| **Telegram channel** | `src/channels/telegram-channel.server.ts` | Bot API webhook → chat thread; outbound replies |
| **WhatsApp (Twilio)** | `src/channels/whatsapp-twilio-channel.server.ts` | Twilio Messaging API ingress/outbound (no Baileys) |
| **Channel hub** | `src/channels/channel-hub.server.ts` | Unified router for multi-channel webhooks |
| **Memory MCP** | `src/mcp/memory-tools.server.ts` | `memory_search`, `memory_remember`, `memory_get` + prompt section |
| **Twilio Voice MCP** | `src/mcp/twilio-voice.server.ts` | `initiate_call`, `end_call`, `get_call_status` |
| **Twilio security** | `src/mcp/twilio-webhook-security.server.ts` | HMAC-SHA1 signature verification |
| **TwiML** | `src/mcp/twiml.server.ts` | Voice webhook response helpers |
| **Org webhooks** | `src/webhooks/org-webhooks.server.ts` | HMAC-signed single-route ingress |
| **Webhook registry** | `src/webhooks/webhook-registry.server.ts` | Multi-route + bearer auth + rate limits |
| **Cron-lite** | `src/scheduler/cron-lite.server.ts` | Scheduled chat runs (OpenClaw cron subset) |
| **Rate limit** | `src/lib/rate-limit.ts` | Fixed-window limiter (from OpenClaw webhook-ingress) |
| **Marketplace** | `src/marketplace/composio-additions.ts` | `telegram` + `spotify` Composio toolkits |

## Related packages

| Path | Purpose |
|------|---------|
| `skills/import-openclaw/` | OpenClaw `SKILL.md` → `ao_skills` CLI importer |
| `skills/import-openclaw/bundled/` | Pre-synced playbook seeds (slack, discord, browser, voice-call, tavily) |
| `scripts/sync-openclaw-skills.ts` | Re-sync skills from local openclaw clone |
| `scripts/audit-composio-vs-openclaw.ts` | Composio catalog vs OpenClaw extension diff |

## Channel setup

### Telegram
1. Create bot via [@BotFather](https://t.me/BotFather)
2. Register webhook with `setTelegramWebhook(botToken, { url, secret_token })`
3. Mount `handleChannelWebhook(req, "telegram", orgId, deps)`

### WhatsApp (Twilio)
1. Enable WhatsApp sandbox or Business API in Twilio
2. Set webhook URL to `buildWhatsAppWebhookPath(orgId)`
3. Mount `handleChannelWebhook(req, "whatsapp", orgId, deps)`

## Memory tools

```ts
const store: MemoryStore = {
  search: (p) => memoryGraphSearch(p),
  remember: (p) => memoryGraphRemember(p),
  get: (p) => memoryGraphGet(p),
};
export const memoryTools = createMemoryMcpTools(store);
// Inject buildMemoryPromptSection() into system prompt
```

## Cron-lite

```ts
const cron = createCronService(async ({ orgId, threadKey, message }) => {
  await chatRunner({ orgId, threadKey, inbound: { ... } });
});
cron.add({
  id: "morning-brief",
  orgId, name: "Morning brief",
  schedule: { kind: "cron", expression: "0 8 * * *", timezone: "America/New_York" },
  threadKey: "cron:morning", message: "Run morning brief playbook",
  enabled: true,
});
```

## Webhooks

**Single route:** HMAC `x-oweb-signature` + `x-oweb-timestamp`

**Multi-route registry:** Bearer `Authorization: Bearer <secret>` OR HMAC headers, with per-route rate limits.

## Sync OpenClaw skills

```bash
git clone https://github.com/openclaw/openclaw /tmp/openclaw
npx tsx scripts/sync-openclaw-skills.ts --openclaw /tmp/openclaw
```

## Tests

```bash
cd oweb-gap-closures && npm test
```

## Integration checklist (OWeb)

- [ ] Mount channel hub routes for telegram + whatsapp
- [ ] Wire memory MCP + `buildMemoryPromptSection()` into chat harness
- [ ] Register Twilio Voice MCP + TwiML status webhook
- [ ] Deploy webhook registry with per-org route table
- [ ] Connect cron-lite to Vercel cron or pg_cron worker
- [ ] Import bundled skills into `ao_skills` via Settings → Skills
- [ ] Add `telegram` + `spotify` to `composio-marketplace.ts`
