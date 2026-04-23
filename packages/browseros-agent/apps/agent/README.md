# BrowserOS Agent Extension

[![License: AGPL v3](https://img.shields.io/badge/License-AGPL%20v3-blue.svg)](../../../../LICENSE)

The built-in browser extension that powers BrowserOS's AI interface — new tab with unified search, side panel chat, onboarding, and settings. Built with [WXT](https://wxt.dev) and React.

> For user-facing feature documentation, see [docs.browseros.com](https://docs.browseros.com).

## Features

- **AI-Powered New Tab**: Custom new tab page with unified search across Google and AI assistants
- **Agent Command Center**: Alpha new tab command surface for launching and resuming OpenClaw agent conversations
- **Side Panel Chat**: Full-featured chat interface for interacting with BrowserOS
- **Multi-Provider Support**: Connect to various LLM providers (OpenAI, Anthropic, Azure, Bedrock, and more)
- **MCP Integration**: Model Context Protocol support for extending AI capabilities
- **Visual Feedback**: Animated glow effect on tabs during AI agent operations
- **Privacy-First**: Local data handling with configurable provider settings

## How It Connects

The extension communicates with the [BrowserOS Server](../../apps/server/) running locally. The server handles the AI agent loop, MCP tools, and CDP connections — the extension provides the UI layer.

## Project Structure

```
entrypoints/
├── background.ts          # Service worker for extension lifecycle
├── content.ts             # Content script (Google pages)
├── glow.content/          # Visual glow effect for active AI operations
├── app/                   # Full-page app shell, settings, and command center
├── newtab/                # Custom new tab page
├── sidepanel/             # AI chat side panel
├── onboarding/            # First-time user onboarding flow
└── options/               # Extension settings dashboard

components/
└── ui/                    # Shadcn UI components

lib/                       # Shared utilities and hooks
```

## Entrypoints

### Background (`background.ts`)

The service worker that manages:
- Side panel toggling via browser action
- BrowserOS Core health checks
- MCP tools fetching
- LLM provider configuration backup
- Extension installation triggers (opens onboarding)

### New Tab (`newtab/`)

Custom new tab replacement featuring:
- **Unified Search Bar**: Search Google or ask AI directly
- **Tab Context**: Attach open tabs to provide context for AI queries
- **Search Suggestions**: Real-time suggestions from multiple providers (Google, Bing, DuckDuckGo, Yahoo, Yandex)
- **AI Suggestions**: Context-aware BrowserOS action suggestions
- **Top Sites**: Quick access to frequently visited sites
- **Theme Toggle**: Light/dark mode support

### App Shell and Agent Command Center (`app/`)

Full-page extension app mounted at `app.html` with sidebar navigation, settings, onboarding redirects, and alpha-only OpenClaw agent surfaces.

The Agent Command Center is mounted under `/home` when `ALPHA_FEATURES_SUPPORT` is available:
- `/home` renders `AgentCommandHome`, which lists OpenClaw agents, selects an active agent, and routes prompt submissions to the selected conversation.
- `/home/agents/:agentId` renders `AgentCommandConversation`, which owns the focused chat view for one OpenClaw agent.
- `agent-command-layout.tsx` polls OpenClaw status and agent metadata through `useOpenClawStatus` and `useOpenClawAgents`.
- `useAgentConversation.ts` sends messages through `chatWithAgent` to `/claw/agents/:agentId/chat`, consumes BrowserOS SSE chat events, and persists completed turns.

#### Command Center History Integration

Command-center conversations have two history layers:
- **Local UI cache**: `lib/agent-conversations/storage.ts` stores conversations in IndexedDB with keys shaped as `agent-conv:${agentId}:${sessionKey}`. `useAgentConversation.ts` loads the latest local conversation for an agent, keeps its `sessionKey`, saves completed turns, and sends text-only prior turns as the `history` payload for the next chat request.
- **OpenClaw session history**: BrowserOS Server exposes `GET /claw/session/:sessionKey/history`, which proxies OpenClaw's `/sessions/:sessionKey/history` endpoint. The default response is JSON `{ sessionKey, messages, cursor, hasMore, truncated }`; `limit` and `cursor` query params are forwarded for pagination.

When the command center needs gateway-backed restore or live sync, use the same `sessionKey` carried by the local conversation:
- Fetch JSON history for initial restore or backfill.
- Request `Accept: text/event-stream` to stream named `history`, `message`, and `error` events for live tailing.
- Keep IndexedDB as a fast UI cache, but treat the OpenClaw history endpoint as the source for messages that were persisted by the gateway.
- Treat a `404` history response as a missing or expired OpenClaw session and start a fresh local conversation.
- Abort any history stream when navigating away or resetting the conversation.

### Side Panel (`sidepanel/`)

The main chat interface for BrowserOS:
- **Chat Modes**: Switch between chat and agent modes
- **Provider Selector**: Choose from configured LLM providers
- **Tab Attachment**: Include browser tab content as context
- **Tool Calls**: Visual display of MCP tool invocations
- **Message Actions**: Like/dislike feedback, copy responses
- **Conversation Management**: Start new conversations, view history

### Onboarding (`onboarding/`)

Multi-step onboarding flow for new users:
- Welcome screen with product highlights
- Feature showcase with animated cards
- Step-by-step setup wizard
- Provider configuration guidance

### Options (`options/`)

Settings dashboard with multiple sections:
- **AI Settings**: Configure LLM providers (API keys, models, base URLs)
- **LLM Hub**: Manage chat-specific provider settings
- **MCP Settings**: View and manage MCP server connections
- **Connect MCP**: Add managed or custom MCP servers

### Glow Content (`glow.content/`)

Content script that creates a visual indicator (pulsing orange glow) around the browser viewport when an AI agent is actively working on a tab.

## Development

### Prerequisites

- [Bun](https://bun.sh) installed
- Chrome or Chromium-based browser
- BrowserOS Server running locally (for full functionality)

### Setup

```bash
# Copy environment file
cp .env.example .env.development

# Install dependencies
bun install

# Start development server
bun run dev

# Build for production
bun run build

# Create distributable zip
bun run zip
```

### Loading the Extension

1. Run `bun run dev` to start the development server
2. Open Chrome and navigate to `chrome://extensions`
3. Enable "Developer mode"
4. Click "Load unpacked" and select the `dist/` directory

### Environment Variables

Create a `.env.development` file for local development:

```env
SENTRY_ORG=your-org
SENTRY_PROJECT=your-project
SENTRY_AUTH_TOKEN=your-token
```

### GraphQL Schema

Codegen requires a GraphQL schema. By default it uses the bundled `schema/schema.graphql`, so no extra setup is needed. If you have access to the original API source, you can set the following environment variable:

```env
GRAPHQL_SCHEMA_PATH=/path/to/api-repo/.../schema.graphql
```

## Development Tooling

### Bun

Bun is the exclusive runtime and package manager:
- All scripts use `bun run <script>` instead of npm
- Package installation via `bun install`
- Environment files automatically loaded (no dotenv needed)
- Enforced via `engines` field in `package.json`

### Biome

Unified linter and formatter configured in `biome.json`:
- **Formatting**: 2-space indentation, single quotes, no semicolons
- **Linting**: Recommended rules plus custom rules for unused imports/variables
- **CSS Support**: Tailwind directives parsing enabled
- **Import Organization**: Automatic import sorting via assist actions

## Scripts

| Script | Description |
|--------|-------------|
| `bun run dev` | Start development mode with hot reload |
| `bun run build` | Build production extension |
| `bun run zip` | Create distributable zip file |
| `bun run lint` | Run Biome linter |
| `bun run lint:fix` | Auto-fix linting issues |
| `bun run typecheck` | Run TypeScript type checking |
| `bun run codegen` | Generate GraphQL types |
| `bun run clean:cache` | Clear build caches |
