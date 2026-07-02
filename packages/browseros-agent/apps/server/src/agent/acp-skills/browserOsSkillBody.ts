/**
 * @license
 * Copyright 2025 BrowserOS
 * SPDX-License-Identifier: AGPL-3.0-or-later
 *
 * Canonical `SKILL.md` body for the built-in `browseros` skill. Sourced
 * here so a single string is both the source of truth for the shipped
 * skill installed into each ACP workspace AND the value we can mirror
 * into `RUNTIME_SKILLS.browseros` for the harness runtime.
 *
 * Tightened from the previous doctrine to open with an explicit
 * prohibition against `agent.browsers.*` / `computer_use` — those were
 * the abstractions Codex kept drifting to on the first turn instead of
 * calling the browseros MCP tools. Naming them here so the model has to
 * override its own defaults to skip us.
 */
export const BROWSEROS_SKILL_BODY = `---
name: browseros
description: Use BrowserOS MCP for any browser interaction — clicking, typing, navigation, screenshots, tab management, downloads, PDF reads. Auto-activate whenever the task involves a Chromium browser or a URL to visit.
---

# BrowserOS MCP is the browser

For any task that requires interacting with a Chromium browser you MUST use the \`mcp__browseros.*\` tools. Do not attempt \`agent.browsers.get(...)\`, do not attempt \`computer_use\`, do not attempt any other browser abstraction — those either do not exist or will not work in this session.

## Workflow

1. **Observe** with \`mcp__browseros.snapshot\` or \`mcp__browseros.tabs\` first. Get a fresh view of the DOM refs before acting.
2. **Act** using refs from the snapshot: \`mcp__browseros.act\` for click / fill / hover / select / press / scroll, \`mcp__browseros.navigate\` for url / back / forward / reload.
3. **Verify** after actions, navigation, form submissions, and downloads — take another snapshot to confirm state.

## Recovery

- Ref stale (post-navigation) → snapshot again; all refs invalidate on navigation.
- Element not visible → \`act kind="scroll"\`, snapshot, retry once.
- Two failed attempts on the same target → describe the blocker and ask the user for guidance.
- Login / CAPTCHA / 2FA gate → pause and ask the user to complete it manually.

## Third-party apps

For SaaS integrations (Gmail, Slack, GitHub, Notion, Linear, Jira, Google Calendar, and 40+ more), use \`mcp__browseros.connector_mcp_servers(server_name)\` to check the connection status before any Strata action. If not connected the response includes an authUrl; prompt the user to authenticate through that URL and confirm before retrying.
`
