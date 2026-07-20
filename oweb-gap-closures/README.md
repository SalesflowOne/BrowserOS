# OWeb OpenClaw Gap Closures

Portable TypeScript modules + **full integration layer** for OWeb.

## Quick start (Vercel)

```ts
// app/api/[...oweb]/route.ts
export { GET, POST } from "@oweb/gap-closures/entrypoints/vercel-route";
```

Or wire manually:

```ts
import { createOwebIntegration, createInMemoryChannelConfigStore, createHttpChatRunner } from "@oweb/gap-closures";

const integration = createOwebIntegration({
  publicBaseUrl: "https://oweb.one",
  cronSecret: process.env.CRON_SECRET,
  channelStore: mySupabaseChannelStore,
  getOrgConfig: (id) => mySupabaseChannelStore.get(id),
  getWebhookRoute: (org, route) => myStore.getRoute(org, route),
  chatRunner: createHttpChatRunner({
    endpoint: "https://oweb.one/api/internal/channel-chat",
    apiKey: process.env.OWEB_SERVICE_KEY!,
  }),
  memoryStore: memoryGraphAdapter,
  twilioVoice: process.env.TWILIO_ACCOUNT_SID ? { ... } : null,
});

export const POST = (req: Request) => integration.handle(req);
```

## API routes (auto-mounted)

| Method | Path | Purpose |
|--------|------|---------|
| POST | `/api/channels/telegram/webhook?org=` | Telegram ingress |
| POST | `/api/channels/whatsapp/webhook?org=` | WhatsApp (Twilio) ingress |
| POST | `/api/channels/telegram/setup` | Register bot + set webhook |
| POST | `/api/channels/whatsapp/setup` | Save Twilio WhatsApp config |
| GET | `/api/channels/status?org=` | Channel connection status |
| POST | `/api/webhooks/org/:orgId/:routeId` | Signed webhook ingress |
| POST | `/api/voice/twilio/status?org=` | Twilio call status callback |
| GET/POST | `/api/voice/twilio/twiml?org=` | TwiML greeting |
| GET/POST | `/api/cron/oweb-jobs` | Vercel cron tick |
| GET | `/api/integrations/openclaw-marketplace` | Marketplace patch info |

## Modules

| Layer | Path |
|-------|------|
| Channels | `src/channels/` — Telegram, WhatsApp, hub |
| MCP | `src/mcp/` — memory, Twilio voice, webhook security |
| Webhooks | `src/webhooks/` — org + multi-route registry |
| Scheduler | `src/scheduler/cron-lite.server.ts` |
| **Integration** | `src/integration/` — router, MCP bundle, skills seeder |
| UI | `ui/ChannelsSettings.tsx` — connect flows |
| Migrations | `migrations/001_openclaw_integration.sql` |

## MCP registration

```ts
import { createOwebMcpBundle, registerMcpBundleOnServer } from "@oweb/gap-closures";

const bundle = createOwebMcpBundle({ memoryStore, twilioVoice: cfg });
registerMcpBundleOnServer(mcpServer, bundle, () => ({ orgId }));
// Inject bundle.promptSections into system prompt
```

## Seed bundled skills

```bash
# SQL for Supabase
npx tsx scripts/seed-ao-skills.ts --org <uuid> --sql --output seed.sql

# Or POST to admin API
npx tsx scripts/seed-ao-skills.ts --org <uuid> --api https://oweb.one/api/admin/skills --key $KEY
```

## Channels UI

```tsx
import { ChannelsSettings } from "@oweb/gap-closures/ui/ChannelsSettings";

<ChannelsSettings orgId={org.id} apiBase="https://oweb.one" authToken={session.token} />
```

## Vercel cron

Copy `vercel.integration.example.json` crons into your `vercel.json`. Set `CRON_SECRET`.

## Database

Run `migrations/001_openclaw_integration.sql` for `ao_channel_configs`, `ao_webhook_routes`, `ao_cron_jobs`.

## Tests

```bash
cd oweb-gap-closures && npm test   # 36 tests
```

## Related

- `skills/import-openclaw/` — SKILL.md importer + bundled playbooks
- `scripts/sync-openclaw-skills.ts` — re-sync from openclaw repo
- `docs/OPENCLAW_CAPABILITY_AUDIT.md` — full audit
