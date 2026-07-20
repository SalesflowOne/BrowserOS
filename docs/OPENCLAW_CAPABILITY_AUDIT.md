# OpenClaw → OWeb Capability Audit

> **Date:** 2026-07-20  
> **Scope:** Top 20 OpenClaw extensions + ClawHub `SKILL.md` playbooks vs OWeb Composio toolkits, `ao_skills`, and builtins.  
> **Constraint:** Do not port OpenClaw plugin runtime; do not modify `lovable-chat.ts` unless unavoidable.

## Executive summary

| Layer | OpenClaw | OWeb today |
|-------|----------|------------|
| **Integrations** | ~150 extension plugins (channels, search, memory, voice, LLM providers) | Composio v3 toolkits + first-party MCP (Google Ads) + custom MCP |
| **Playbooks** | Extension-bundled + ClawHub `SKILL.md` (agentskills.io) | `ao_skills` markdown playbooks + `composio-toolkit-playbooks.server.ts` routing hints |
| **Chat harness** | OpenClaw daemon + channel routers | `src/routes/api/lovable-chat.ts` (loads Composio + org skills into system prompt) |
| **Browser** | CDP extension + `browser` tool | `browser_tool` (Composio) + Anchor direct API + `browse_web` builtin |
| **Channels** | 20+ native (WhatsApp, Telegram, Signal, iMessage, …) | Slack, Teams, Discord, email digest via Composio + Azure Bot |
| **Memory** | `memory-core`, LanceDB, wiki plugins | `ao_entities` memory graph + org skills |
| **Secrets** | `onepassword`, `vault` plugins | OWeb Vault (`ao_vault_credentials`) for browser skills |

**Verdict:** ~70% of high-value OpenClaw *integration* surface maps to existing Composio toolkits or OWeb builtins. The largest gaps are **messaging channels** (Telegram, Signal, iMessage, WhatsApp-native), **always-on daemon/webhook ingress**, and **OpenClaw-specific tool vocab** in bundled skills. Skills are the highest-ROI import target — translate `SKILL.md` → `ao_skills` rather than porting plugins.

---

## OWeb integration inventory (reference)

### Always-on Composio toolkits
- `browser_tool`, `composio_search`

### Platform API-key toolkits (deployment env)
- `anchor_browser`, `firecrawl`, `tavily`

### Curated marketplace / power toolkits
`slack`, `microsoft_teams`, `outlook`, `discord`, `notion`, `hubspot`, `salesforce`, `linear`, `stripe`, `github`, `airtable`, `jira`, `asana`, `shopify`, `twilio`, `gmail`, `googledrive`, `googlecalendar`, `googlesheets`, `googlesuper`, `metaads`, `firecrawl`, `tavily`, `perplexityai`, `zendesk`, …

### First-party MCP (replaces Composio where connected)
- `google_ads_mcp` (suppresses Composio `googleads`)

### Built-in chat tools (not Composio)
- `browse_web`, `search_tools`, `invoke_tool` / `run_composio_tool`, `request_integration`, v0/GitHub/sandbox/resend tools, custom MCP merge

### Org playbooks (`ao_skills`)
- Loaded by `loadActiveSkillsForOrg()` → `buildSkillsPromptSection()` in `lovable-chat.ts`
- Built-in templates in `skill-templates.ts` (research_stack, morning_brief, warm_outreach, …)
- Per-toolkit routing playbooks in `composio-toolkit-playbooks.server.ts`

---

## Top 20 OpenClaw extensions → OWeb mapping

| # | OpenClaw extension | Primary capability | OWeb capability | Status | Notes |
|---|-------------------|-------------------|-----------------|--------|-------|
| 1 | **brave** | Web search API provider | `composio_search` (Tavily/DuckDuckGo), `tavily`, `perplexityai` | Covered | No Brave-specific Composio slug; Tavily is default in `research_stack` playbook |
| 2 | **browser** | CDP browser automation + bundled `browser-automation` skill | `browser_tool` + Anchor + `browse_web` + browser skills runtime | Partial | Different tool API (`action=snapshot` vs `BROWSER_TOOL_*`). Import skill body with tool-name rewrite |
| 3 | **slack** | Channel + `slack` skill | Composio `slack` + `slack-channel.server.ts` + Channels UI | Covered | Skill maps cleanly; rewrite `slack` tool → `slack__SLACK_*` Composio slugs |
| 4 | **discord** | Channel + skill | Composio `discord` + Composio triggers + Channels | Covered | `DISCORD_SEND_*` slug fallbacks already in `channel-utils.ts` |
| 5 | **telegram** | Messaging channel | `telegram-channel.server.ts` + Composio `telegram` | Covered (impl) | Portable module in `oweb-gap-closures/`; wire to OWeb API router |
| 6 | **whatsapp** | WhatsApp Web channel | `whatsapp-twilio-channel.server.ts` + Composio `twilio` | Covered (impl) | Twilio Messaging API — no Baileys/WhatsApp Web |
| 7 | **google** | Gemini/Vertex LLM providers + media | AI Gateway model router (`model-router.server.ts`) | Different layer | Gmail/Calendar/Drive are separate Composio toolkits |
| 8 | **gmail** | (via Google workspace / Composio) | Composio `gmail` + inbox digest channel | Covered | Morning brief playbook already references Gmail |
| 9 | **spotify** | Media control | Composio `spotify` marketplace entry | Covered (impl) | Add via `composio-additions.ts`; no custom runtime |
| 10 | **memory-core** | Agent memory tools contract | `memory-tools.server.ts` + `ao_entities` | Covered (impl) | MCP `memory_search` / `memory_remember` over memory graph adapter |
| 11 | **voice-call** | PSTN calls (Twilio/Telnyx/Plivo) | `twilio-voice.server.ts` + Composio `twilio` | Covered (impl) | MCP `initiate_call` / `end_call`; TwiML URL required |
| 12 | **webhooks** | Authenticated inbound webhooks → TaskFlow | `org-webhooks.server.ts` + platform webhooks | Covered (impl) | Per-org signed URLs → chat runner queue |
| 13 | **tavily** | Web search provider | `composio_search` + platform `tavily` toolkit | Covered | Always available via composio_search even without OAuth |
| 14 | **firecrawl** | Web fetch/scrape | Platform `firecrawl` + `browse_web` fallback | Covered | `research_stack` playbook documents fallback chain |
| 15 | **perplexity** | Web search / answers | Composio `perplexityai` | Covered | Listed in marketplace Popular section |
| 16 | **onepassword** | Secrets broker w/ approval | OWeb Vault (`vault.server.ts`) | Different model | Vault is portal-login focused; no 1Password Connect integration |
| 17 | **imessage** | iMessage channel (macOS) | — | Gap | Platform-specific; no OWeb equivalent |
| 18 | **signal** | Signal channel | — | Gap | No Signal integration |
| 19 | **msteams** | Microsoft Teams channel | Composio `microsoft_teams` + `teams-bot.server.ts` | Covered | Requires Azure Bot setup (`docs/channels/TEAMS_SETUP.md`) |
| 20 | **microsoft / outlook** | Outlook mail/calendar | Composio `outlook` + inbox digest | Covered | `pickMailToolkit()` prefers Gmail then Outlook |

### Summary counts
- **Covered (15):** brave, slack, discord, telegram, whatsapp, gmail, spotify, memory-core, voice-call, webhooks, tavily, firecrawl, perplexity, msteams, outlook
- **Partial (3):** browser, google (LLM), onepassword
- **Gap (2):** imessage, signal

---

## ClawHub / bundled skills vs OWeb playbooks

OpenClaw ships skills at `extensions/<id>/skills/<name>/SKILL.md` and ClawHub distributes the same agentskills.io format.

| Aspect | OpenClaw SKILL.md | OWeb `ao_skills` |
|--------|-------------------|------------------|
| Storage | Filesystem / ClawHub registry | Supabase `ao_skills` rows |
| Frontmatter | `name`, `description`, `metadata.openclaw.*` | `name`, `description`, `content`, `status`, `enabled`, `source` |
| Injection | OpenClaw skill loader at daemon start | `buildSkillsPromptSection()` in chat system prompt |
| Tool references | Native tools (`slack`, `browser`) | Composio namespaced (`slack__SLACK_SEND_MESSAGE`) |
| Requires | `metadata.openclaw.requires.config` | Implicit — agent must call `request_integration` |

**Examples analyzed:**
- `extensions/slack/skills/slack/SKILL.md` → rewrite to Composio Slack tool slugs
- `extensions/browser/skills/browser-automation/SKILL.md` → rewrite `browser` actions → `browser_tool__BROWSER_TOOL_*` + OWeb browser rules from `browser-tools.server.ts`

OWeb's `composio-toolkit-playbooks.server.ts` already provides *routing* playbooks (HubSpot, Jira, Stripe, …) that OpenClaw lacks — the importer should **preserve** these and only add org-level skills from OpenClaw.

---

## Gap closure proposals (minimal — no plugin runtime)

### 1. Messaging channels (Telegram, Signal, iMessage, WhatsApp Web)
**Proposal:** Thin webhook ingress + Composio outbound where available.

| Channel | Minimal builtin | MCP / external |
|---------|----------------|----------------|
| Telegram | `telegram-channel.server.ts` — Bot API webhook → chat thread | Composio `telegram` toolkit if catalog supports send |
| WhatsApp | Extend existing Twilio integration | Twilio WhatsApp API via Composio `twilio` |
| Signal | — | Signal-cli REST MCP wrapper (self-hosted, opt-in) |
| iMessage | — | macOS-only; defer or document as out-of-scope |

### 2. Spotify / media control
**Proposal:** Enable Composio `spotify` toolkit in marketplace if available; no custom runtime.

### 3. Always-on webhooks (OpenClaw `webhooks` parity)
**Proposal:** Extend `platform-webhooks.server.ts` with per-org signed URLs that enqueue to existing Vercel Queue → same chat runner path.

### 4. Voice-call (PSTN)
**Proposal:** MCP wrapper around Twilio Voice (already have `twilio` Composio + `twilio` npm dep). Tools: `initiate_call`, `end_call`.

### 5. 1Password secrets
**Proposal:** Optional MCP server using 1Password Connect API; map reads to OWeb Vault grant flow.

### 6. Memory tools (OpenClaw `memory-core`)
**Proposal:** Expose `ao_entities` via two MCP tools: `memory_search`, `memory_remember`. Logic exists in `memory-graph.server.ts`.

---

## Importer: `skills/import-openclaw/`

See `skills/import-openclaw/README.md`. Design principles:

1. **Input:** OpenClaw `SKILL.md` (file, directory, or ClawHub git URL)
2. **Output:** `ao_skills` insert payload or JSON seed
3. **Transforms:** strip `metadata.openclaw`, rewrite tool names via `mappings.json`, append prerequisites from `requires.config`, set `status: draft`, `enabled: false`
4. **No changes to `lovable-chat.ts`** — it already calls `loadActiveSkillsForOrg()`

---

## Recommended implementation order

1. ✅ `skills/import-openclaw/` CLI + bundled playbooks (slack, discord, browser-automation, voice-call, tavily)
2. ✅ `scripts/audit-composio-vs-openclaw.ts` + `scripts/sync-openclaw-skills.ts`
3. ✅ Marketplace: `composio-additions.ts` (telegram, spotify)
4. ✅ Channels: Telegram + WhatsApp (Twilio) + channel hub
5. ✅ MCP: memory_search / memory_remember / memory_get + Twilio Voice + TwiML
6. ✅ Webhooks: org-webhooks + multi-route registry with rate limits
7. ✅ Cron-lite scheduler for scheduled agent runs
8. 🔲 Wire modules into OWeb API routes + Channels UI
9. 🔲 Signal-cli MCP (opt-in, self-hosted) — deferred

See `oweb-gap-closures/README.md` for integration checklist.

---

## References

- OpenClaw extensions: https://github.com/openclaw/openclaw/tree/main/extensions
- OWeb Composio constants: `src/lib/composio-constants.ts`
- OWeb toolkit playbooks: `src/lib/composio-toolkit-playbooks.server.ts`
- OWeb org skills: `src/lib/skills.server.ts`
- Chat harness: `src/routes/api/lovable-chat.ts` (unchanged by this audit)
