---
name: marketing-tools
description: Reference shelf — opinionated SaaS catalogue for marketing, sales, and growth work. Use to look up a specific tool by category (analytics, email, affiliate, partner, CRM, etc.) when another skill (cold-email, emails, launch, referrals, etc.) points at a `marketing-tools/integrations/<name>.md` guide, or when you need a one-glance summary of which vendor fits a job. Not a tutorial — a registry.
metadata:
  version: 1.0.0
---

# Marketing Tools Registry

A vendored, opinionated catalogue of third-party SaaS tools that other skills reference for concrete recommendations.

- **`REGISTRY.md`** — top-level index, grouped by category (analytics, email, affiliate, partner, social, etc.).
- **`integrations/<name>.md`** — per-tool integration guide. What the tool does, when to pick it, how to wire it up, gotchas.
- **`clis/<name>.js`** — sample CLI helpers for a subset of integrations (read-only, for reference).
- **`composio/`** — Composio-specific connector notes.

## When to read this skill

You don't pick `marketing-tools` directly. Other skills (`cold-email`, `emails`, `launch`, `referrals`) cite specific files in this tree when they recommend a vendor. Follow the link, read the per-tool guide, surface the recommendation to the user.

## Updating

Vendored from `coreyhaines31/marketingskills` (see `ATTRIBUTION.md`). To refresh, replace the whole `marketing-tools/` directory with the upstream `tools/` directory at the pinned commit, then update the attribution.
