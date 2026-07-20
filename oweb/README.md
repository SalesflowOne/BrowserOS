# OWeb Browser — Windows quick start

Everything is in **this repo**. You do not need a second checkout.

## Prerequisites (one-time)

1. **Visual Studio 2022** with "Desktop development with C++" and Windows 10/11 SDK  
2. **Python 3.12+** — https://www.python.org/downloads/ (check "Add to PATH")  
3. **~100 GB free disk** on `C:` (Chromium source is huge)  
4. **Git** — https://git-scm.com/download/win  

## Three commands

Open **PowerShell as Administrator** in this repo folder:

```powershell
# 1. Install build tools + validate OWeb product
.\oweb\setup-windows.ps1

# 2. Download Chromium source (hours, ~100 GB) — only needed once
.\oweb\fetch-chromium.ps1

# 3. Build OWeb Browser (debug, unsigned)
.\oweb\build-windows.ps1
```

The installer/exe path is printed when the build finishes.

## Sign in to OWeb

After install, the browser uses:

- Sign-in: https://oweb.one/auth/browser  
- Your OWeb account, credits, and connected tools  

## Agent-only dev (skip Chromium compile)

If you only want to hack the AI side panel without building Chromium:

```powershell
cd packages\browseros-agent
copy ..\..\oweb\agent.env.example .env.development
bun install
bun run dev:setup
bun run dev:watch
```

## Troubleshooting

| Issue | Fix |
|-------|-----|
| `uv` not found | Re-run `setup-windows.ps1` or restart PowerShell |
| Out of disk | Free space on `C:\` — Chromium lives under `C:\src\chromium` by default |
| VS not found | Install VS 2022 C++ workload, then reopen PowerShell |
| `product doctor` fails | Run `python oweb\generate-icons.py` |
| GN `browseros_product` assert | Ensure you built with `--product oweb` (not browseros/browserclaw) |

## Upstream sync

```powershell
git remote add upstream https://github.com/browseros-ai/BrowserOS.git
git fetch upstream
git merge upstream/main
```
