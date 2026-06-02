---
name: app-connections
description: Use when a task needs a third-party SaaS app (Gmail, Google Calendar/Docs/Drive/Sheets, Slack, GitHub, Notion, Linear, Jira, Figma, Salesforce, HubSpot, Stripe, Discord, LinkedIn, Cal.com, Resend, Asana, ClickUp, Monday, Outlook, Supabase, Vercel, Postman, Cloudflare, Dropbox, OneDrive, WordPress, YouTube, Box, Shopify, Zendesk, Intercom, etc.) — or when a tool call returns 401/Unauthorized, or when a connector check says "not connected", or when a response surfaces an authUrl / apiKeyUrl. Drives the connect → discover → execute flow over BrowserOS's Klavis Strata integration.
---

# app-connections — third-party services done right

Klavis Strata is BrowserOS's integration layer for 45+ SaaS apps. From
your seat, two MCP namespaces collaborate:

- **`browseros/*`** — the 6 Strata tools (check, discover, execute) + browser automation as fallback.
- **`nudge/suggest_app_connection`** — an in-process MCP tool that renders an interactive **Connect** card to the user. Your only path to ask for authorization.

These are already on the wire whenever the BrowserClaw runtime is up.
Don't try to "install" anything.

## 1. Decision tree

When a turn needs a service:

```
service mentioned ─┐
401 from a tool   ─┼─► is it in "Connected apps" (system prompt lists this)?
authUrl surfaced  ─┘
                       │
              ┌────────┴────────┐
              ▼                 ▼
           CONNECTED         NOT CONNECTED
              │                 │
              ▼                 ▼
       use Strata tools     was it DECLINED earlier in this thread?
       (see §3 below)         │
                              ├── YES → browser automation only.
                              │         Do NOT call suggest_app_connection again.
                              │         Use `browseros/new_page` + snapshots.
                              │
                              └── NO  → call nudge/suggest_app_connection,
                                        then STOP (see §2).
```

**Connection state is per-thread.** It comes from the system prompt the
runtime injects (a "Connected apps" / "Declined apps" block). Re-read
it before you decide.

## 2. The connect ritual (non-negotiable)

When you decide to ask for a connection:

1. Emit **exactly one** tool call: `nudge/suggest_app_connection({ appName, reason })`.
2. Your assistant message **must contain only that tool call**. No prose. No URL. No "I'll connect Gmail now" preamble.
3. After the tool returns, **stop generating**. The UI is now showing a Connect card; the user will OAuth or paste an API key.
4. The user's next message will be `"I've connected <toolkit>, continue with the task."` or `"Continue without connecting <toolkit>. Do it manually..."`. Branch accordingly.

**Why this is strict:** any text or URL you add duplicates the card.
The `ConnectAppCard` is the single source of truth for the
authorization UX — it owns the OAuth popup, the API-key dialog, and
the resume-the-conversation message. Your job is to call the tool and
get out of the way.

### `appName` casing matters

Pass the **exact** display name from the BrowserOS catalog —
proper-case, spaces preserved. The Klavis backend looks up the toolkit
by this string. Wrong casing = "Invalid server" 400.

| Right                 | Wrong                                  |
|-----------------------|----------------------------------------|
| `Gmail`               | `gmail`, `GMail`                       |
| `Google Calendar`     | `google-calendar`, `gcal`, `Gcalendar` |
| `Slack`               | `slack`                                |
| `GitHub`              | `github`, `Github`                     |
| `Cal.com`             | `cal.com`, `Calcom`                    |
| `Microsoft Teams`     | `MS Teams`, `Teams`                    |

If unsure, scan the catalog in §6.

### `reason` is user-facing

One short sentence the user actually reads, starting with "to":

- ✅ `"to read your Linear issues for the standup"`
- ✅ `"to send the Slack message you drafted"`
- ❌ `"because I need it"` (uninformative)
- ❌ `"Gmail OAuth required for SMTP relay…"` (jargon)

## 3. The Strata flow (for connected apps)

Once `appName` is in **Connected apps**, do NOT call the nudge again.
Use the Strata pipeline. Six tools, in this order:

| # | Tool                                       | When                                                              |
|---|--------------------------------------------|-------------------------------------------------------------------|
| 1 | `browseros/connector_mcp_servers`          | Optional sanity check — returns `{ connected, authUrl? }`.        |
| 2 | `browseros/discover_server_categories_or_actions` | **Always start here.** Pass `user_query` + `server_names[]`. |
| 3 | `browseros/get_category_actions`           | If step 2 returned categories, drill in.                          |
| 4 | `browseros/get_action_details`             | Get the parameter schema. **Never skip — never guess params.**    |
| 5 | `browseros/execute_action`                 | Run it. Pass `include_output_fields` to keep the response small.  |
| 6 | `browseros/search_documentation`           | Keyword fallback when the discover flow misses.                   |

**Critical rules:**

- **Discover before executing.** Action names and parameter shapes vary by service and by Klavis version. Guessing wastes a turn and risks irreversible side-effects with the wrong shape.
- **Cap output size.** `execute_action(..., include_output_fields: ['id','title','status'])` instead of dumping the whole record set into context.
- **Independent calls in parallel.** Two `get_action_details` for two different actions? One assistant message, two tool calls.

## 4. Mid-flow auth failures

If `execute_action` returns 401 / "Unauthorized" / "Token expired" for
an app that was previously connected:

1. Call `nudge/suggest_app_connection({ appName, reason: "to re-authenticate <toolkit>, the session expired" })`.
2. Same rules as §2 — only the tool call, then stop.
3. After the user replies, retry the **exact same `execute_action`** with the same parameters. Don't redo discovery.

**Never** call `browseros/new_page` on the `authUrl`. The Connect card
owns the OAuth window — opening it yourself loses the strata bind-back
and the user ends up with a half-finished connection.

## 5. Side-effect discipline

Most Strata actions have real-world consequences. Before calling
`execute_action`, confirm with the user when the action would:

- **Send** (Gmail send, Slack post, WhatsApp message, Discord post, Resend mail)
- **Create / modify** external records (Linear issue, GitHub PR comment, Calendar event, Stripe customer, HubSpot deal)
- **Delete** anything

Pattern: draft the payload in your reply, ask "send this?", then
execute on confirmation. Read-only actions (search, list, get) don't
need this gate.

For irreversible deletes — always confirm, even if the user already
told you "yes do it".

## 6. Supported toolkits (45+)

The exact catalog the BrowserOS backend accepts as `appName`:

**Productivity / Docs**
`Gmail`, `Google Calendar`, `Google Docs`, `Google Drive`, `Google Sheets`, `Google Forms`, `Outlook Mail`, `Outlook Calendar`, `Microsoft Teams`, `OneDrive`, `Dropbox`, `Box`, `Notion`, `Confluence`, `Airtable`

**Dev / Engineering**
`GitHub`, `GitLab`, `Linear`, `Jira`, `Figma`, `Supabase`, `Vercel`, `Postman`, `Cloudflare`, `PostHog`, `Mixpanel`

**Comms / Social**
`Slack`, `Discord`, `WhatsApp`, `LinkedIn`, `Intercom`, `Zendesk`, `Resend`

**Work mgmt / CRM / Sales**
`Asana`, `ClickUp`, `Monday`, `Salesforce`, `HubSpot`, `Stripe`, `Shopify`

**Other**
`Cal.com`, `YouTube`, `WordPress`, `Brave Search`, `Mem0`

If a service you need isn't in this list, it's not Klavis-connectable
— fall back to browser automation (`browseros/take_snapshot`, etc.)
against the service's web UI.

## 7. When NOT to use Klavis

- **Service isn't in the catalog above.** Browser automation instead.
- **User chose "Do it manually" earlier** (it's in **Declined apps**). Browser automation. Never re-nudge a declined app in the same thread.
- **You're inside the connect ritual** (§2). Don't chain Strata tools onto a `suggest_app_connection` reply.
- **The task is to read a single public page** (e.g. "what does YouTube's home page show"). Static fetch. Klavis is for authenticated, user-scoped data.

## 8. Worked example — schedule a meeting from a Linear issue

User: *"Find LIN-432 and put a 30-min review on tomorrow's calendar."*

System prompt shows: `Connected apps: Linear, Google Calendar`.

```
1. discover_server_categories_or_actions
     user_query: "get issue by identifier"
     server_names: ["Linear"]
   → returns actions in the Issues category.

2. get_action_details
     category_name: "Issues"
     action_name: "get_issue"
   → schema: { id: string, ... }

3. execute_action
     server_name: "Linear"
     category_name: "Issues"
     action_name: "get_issue"
     id: "LIN-432"
     include_output_fields: ["id","title","description","url"]
   → { title: "Tighten retry budget", url: "https://linear.app/..." }

4. ASK USER: "Schedule 'Review: Tighten retry budget' tomorrow 3-3:30pm PT on your default calendar? (link in description)" — confirm before creating.

5. On yes:
   get_action_details
     category_name: "Events"
     action_name: "create_event"

6. execute_action
     server_name: "Google Calendar"
     category_name: "Events"
     action_name: "create_event"
     summary: "Review: Tighten retry budget"
     description: "Linear: https://linear.app/..."
     start: "2026-05-27T15:00:00-07:00"
     end:   "2026-05-27T15:30:00-07:00"
     include_output_fields: ["id","htmlLink"]
```

Counter-example — same prompt but the system prompt shows `Connected
apps: (none)`:

```
Step 1 (only):
  nudge/suggest_app_connection
    appName: "Linear"
    reason: "to read Linear issue LIN-432"

[STOP. No text. No second tool call.]
```

After user reconnects → request a second nudge for Google Calendar (in
its own turn), then proceed with the Strata flow above.

## 9. Common mistakes

| Mistake                                                                  | Fix                                                                        |
|--------------------------------------------------------------------------|----------------------------------------------------------------------------|
| Pasting the `authUrl` into your reply text                               | Never. Only the `suggest_app_connection` tool call — the card renders it.  |
| Narrating "Connecting Gmail now..." before the nudge tool call            | The reply must contain ONLY the tool call. Zero prose.                     |
| Calling `suggest_app_connection` for an app in **Declined apps**         | Use browser automation. The user already said no to Klavis for this app.   |
| `appName: "gmail"` (lowercase)                                            | Match catalog casing: `Gmail`. Wrong case = 400.                           |
| Calling `execute_action` without `get_action_details` first              | You'll guess param names wrong. Always inspect the schema.                 |
| Repeating discovery after a 401 mid-flow                                  | Re-auth via nudge, then retry the SAME `execute_action`. Skip rediscovery. |
| `browseros/new_page` on the `authUrl`                                     | The Connect card opens it. Opening it yourself breaks the strata bind.     |
| Dumping the entire `execute_action` response into context                 | Use `include_output_fields` to project just what you need.                 |
| Sending an email / posting a message without confirming the body         | §5. Draft → confirm → send. Side effects need a gate.                      |
| Nudging Gmail again after the user already connected it this thread      | Check the Connected apps block; once connected, jump straight to Strata.   |
| Treating `connector_mcp_servers` as the connect step                      | It only *checks*. To connect, you still call `suggest_app_connection`.     |
| Asking the user to "paste your API key" in chat                          | The card's API-key dialog handles it securely. Don't ask in chat.          |

## 10. Quick reference card

```
NEED A SERVICE
├── In Connected apps?  → discover → get_action_details → execute_action
├── In Declined apps?   → browser automation only (no nudge, no Strata)
└── Neither?            → nudge/suggest_app_connection, STOP, wait

GOT 401 MID-FLOW
└── nudge/suggest_app_connection (reason: re-auth), STOP, then retry exact same execute_action

ABOUT TO SEND/CREATE/DELETE
└── Draft → confirm → execute_action
```
