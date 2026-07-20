# OWeb Browser

This fork builds **OWeb Browser** — a branded AI Chromium browser connected to [oweb.one](https://oweb.one).

## Windows — start here

```powershell
git clone https://github.com/SalesflowOne/BrowserOS.git
cd BrowserOS
.\oweb\setup-windows.ps1
.\oweb\fetch-chromium.ps1
.\oweb\build-windows.ps1
```

See **[oweb/README.md](oweb/README.md)** for prerequisites and troubleshooting.

## What you get

- Branded **OWeb Browser** (`--product oweb`)
- Sign-in via https://oweb.one/auth/browser
- LLM + credits via OWeb API (`/api/browser/v1`)
- Agent UI wired for OWeb auth, branding, and default provider

## Agent-only development

```powershell
cd packages\browseros-agent
copy ..\..\oweb\agent.env.example .env.development
bun install
bun run dev:setup
bun run dev:watch
```

Set `VITE_PRODUCT_ID=oweb` in `.env.development` so the agent uses OWeb auth and hides BYOK.

## Release CI

Dispatch **Release: OWeb Browser (full)** (`.github/workflows/release-oweb.yml`) after secrets are configured (R2, signing, PostHog, Sentry). Platform workflows accept `products: oweb`.

Manual promote after staging:

```bash
cd packages/browseros
uv run browseros release publish --version <ver> --product oweb
uv run browseros release appcast --version <ver> --product oweb --publish
```

## Production launch checklist

| Area | Status | Notes |
|------|--------|-------|
| Chromium product (`oweb`) | Done | GN flags, server bundle, feeds |
| Agent OWeb auth | Done | `VITE_PRODUCT_ID=oweb`, oweb.one redirect |
| Agent branding / BYOK | Done | Cyan theme, logo, hide custom providers |
| Windows build scripts | Done | `oweb/*.ps1` |
| Release CI | Done | `release-oweb.yml` + platform `oweb` option |
| CDN appcasts | Operator | Publish `appcast-oweb*.xml` to CDN |
| macOS team ID | Operator | Replace `PLACEHOLDER` in updater branding |
| Signed Windows/macOS builds | Operator | Run release workflow with secrets |
| E2E sign-in + chat | QA | Verify against live oweb.one backend |
| Legal (privacy, terms) | Operator | Host at oweb.one |

## License

Based on [BrowserOS](https://github.com/browseros-ai/BrowserOS) (AGPL-3.0).
