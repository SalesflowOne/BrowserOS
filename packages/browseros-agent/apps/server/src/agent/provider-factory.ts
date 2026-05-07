import { createAmazonBedrock } from '@ai-sdk/amazon-bedrock'
import { createAnthropic } from '@ai-sdk/anthropic'
import { createAzure } from '@ai-sdk/azure'
import { createGoogleGenerativeAI } from '@ai-sdk/google'
import { createOpenAI } from '@ai-sdk/openai'
import { createOpenAICompatible } from '@ai-sdk/openai-compatible'
import { EXTERNAL_URLS } from '@browseros/shared/constants/urls'
import { LLM_PROVIDERS } from '@browseros/shared/schemas/llm'
import { createOpenRouter } from '@openrouter/ai-sdk-provider'
import { createAcpxProvider } from 'acpx-ai-provider'
import type { LanguageModel } from 'ai'
import { createBrowserOSFetch } from '../lib/browseros-fetch'
import { getBrowserOSMcpUrl } from '../lib/clients/acp/mcp-url'
import { ensureAcpScratchDir } from '../lib/clients/acp/workspace'
import { createCodexFetch } from '../lib/clients/oauth/codex-fetch'
import { createCopilotFetch } from '../lib/clients/oauth/copilot-fetch'
import { logger } from '../lib/logger'
import { createOpenRouterCompatibleFetch } from '../lib/openrouter-fetch'
import type { ResolvedAgentConfig } from './types'

/**
 * Per-agent flag injection for `approve-all` mode.
 *
 * Some agents (codex notably) have an INTERNAL sandbox layer that is
 * separate from the ACP permission flow. With default flags codex-acp
 * runs codex in `read_only` sandbox + `on_request` approval policy —
 * meaning a write attempt is blocked at the codex layer BEFORE it ever
 * hits acpx's permission resolver. The user sees the tool start
 * (`tool-input-start`) and immediately get cancelled, with no
 * permission prompt and no error message.
 *
 * When the user explicitly picks `approve-all` we relax codex's
 * internal gates so writes actually go through. Other modes keep
 * codex's default sandbox so the user gets the conservative behavior
 * they asked for.
 *
 * Shape mirrors acpx's default `AGENT_REGISTRY` entries (the prefix
 * comes from acpx; we only append the `-c` config overrides).
 */
function buildAgentRegistryOverrides(
  agentId: string,
  permissionMode: 'approve-all' | 'approve-reads' | 'deny-all',
): Record<string, string> | undefined {
  if (permissionMode !== 'approve-all') return undefined
  if (agentId === 'codex') {
    return {
      codex:
        'npx @zed-industries/codex-acp@^0.12.0' +
        ' -c approval_policy="never"' +
        ' -c sandbox_mode="workspace-write"',
    }
  }
  return undefined
}

type ProviderFactory = (
  config: ResolvedAgentConfig,
) => (modelId: string) => unknown

function createAnthropicFactory(
  config: ResolvedAgentConfig,
): (modelId: string) => unknown {
  if (!config.apiKey) throw new Error('Anthropic provider requires apiKey')
  return createAnthropic({ apiKey: config.apiKey })
}

function createOpenAIFactory(
  config: ResolvedAgentConfig,
): (modelId: string) => unknown {
  if (!config.apiKey) throw new Error('OpenAI provider requires apiKey')
  return createOpenAI({ apiKey: config.apiKey })
}

function createGoogleFactory(
  config: ResolvedAgentConfig,
): (modelId: string) => unknown {
  if (!config.apiKey) throw new Error('Google provider requires apiKey')
  return createGoogleGenerativeAI({ apiKey: config.apiKey })
}

function createOpenRouterFactory(
  config: ResolvedAgentConfig,
): (modelId: string) => unknown {
  if (!config.apiKey) throw new Error('OpenRouter provider requires apiKey')
  return createOpenRouter({
    apiKey: config.apiKey,
    extraBody: { reasoning: {} },
    fetch: createOpenRouterCompatibleFetch(),
  })
}

function createAzureFactory(
  config: ResolvedAgentConfig,
): (modelId: string) => unknown {
  if (!config.apiKey || !config.resourceName) {
    throw new Error('Azure provider requires apiKey and resourceName')
  }
  return createAzure({
    resourceName: config.resourceName,
    apiKey: config.apiKey,
  })
}

function createLMStudioFactory(
  config: ResolvedAgentConfig,
): (modelId: string) => unknown {
  if (!config.baseUrl) throw new Error('LMStudio provider requires baseUrl')
  return createOpenAICompatible({
    name: 'lmstudio',
    baseURL: config.baseUrl,
    ...(config.apiKey && { apiKey: config.apiKey }),
  })
}

function createOllamaFactory(
  config: ResolvedAgentConfig,
): (modelId: string) => unknown {
  if (!config.baseUrl) throw new Error('Ollama provider requires baseUrl')
  return createOpenAICompatible({
    name: 'ollama',
    baseURL: config.baseUrl,
    ...(config.apiKey && { apiKey: config.apiKey }),
  })
}

function createBedrockFactory(
  config: ResolvedAgentConfig,
): (modelId: string) => unknown {
  if (!config.accessKeyId || !config.secretAccessKey || !config.region) {
    throw new Error(
      'Bedrock provider requires accessKeyId, secretAccessKey, and region',
    )
  }
  return createAmazonBedrock({
    region: config.region,
    accessKeyId: config.accessKeyId,
    secretAccessKey: config.secretAccessKey,
    sessionToken: config.sessionToken,
  })
}

function createBrowserOSFactory(
  config: ResolvedAgentConfig,
): (modelId: string) => unknown {
  if (!config.baseUrl) throw new Error('BrowserOS provider requires baseUrl')
  const { baseUrl, apiKey, upstreamProvider, browserosId } = config
  const browserosFetch = browserosId
    ? createBrowserOSFetch(browserosId)
    : createOpenRouterCompatibleFetch()

  if (upstreamProvider === LLM_PROVIDERS.OPENROUTER) {
    return createOpenRouter({
      baseURL: baseUrl,
      ...(apiKey && { apiKey }),
      fetch: browserosFetch,
    })
  }
  if (upstreamProvider === LLM_PROVIDERS.ANTHROPIC) {
    return createAnthropic({
      baseURL: baseUrl,
      ...(apiKey && { apiKey }),
      fetch: browserosFetch,
    })
  }
  if (upstreamProvider === LLM_PROVIDERS.AZURE) {
    return createAzure({
      baseURL: baseUrl,
      ...(apiKey && { apiKey }),
      fetch: browserosFetch,
    })
  }
  logger.debug('Creating OpenAI-compatible provider for BrowserOS')
  return createOpenAICompatible({
    name: 'browseros',
    baseURL: baseUrl,
    ...(apiKey && { apiKey }),
    fetch: browserosFetch,
  })
}

function createOpenAICompatibleFactory(
  config: ResolvedAgentConfig,
): (modelId: string) => unknown {
  if (!config.baseUrl)
    throw new Error('OpenAI-compatible provider requires baseUrl')
  return createOpenAICompatible({
    name: 'openai-compatible',
    baseURL: config.baseUrl,
    ...(config.apiKey && { apiKey: config.apiKey }),
  })
}

function createMoonshotFactory(
  config: ResolvedAgentConfig,
): (modelId: string) => unknown {
  if (!config.baseUrl) throw new Error('Moonshot provider requires baseUrl')
  if (!config.apiKey) throw new Error('Moonshot provider requires apiKey')
  return createOpenAICompatible({
    name: 'moonshot',
    baseURL: config.baseUrl,
    apiKey: config.apiKey,
  })
}

function createQwenCodeFactory(
  config: ResolvedAgentConfig,
): (modelId: string) => unknown {
  if (!config.apiKey) throw new Error('Qwen Code requires OAuth authentication')
  return createOpenAICompatible({
    name: 'qwen-code',
    baseURL: EXTERNAL_URLS.QWEN_CODE_API,
    apiKey: config.apiKey,
  })
}

function createGitHubCopilotFactory(
  config: ResolvedAgentConfig,
): (modelId: string) => unknown {
  if (!config.apiKey)
    throw new Error('GitHub Copilot requires OAuth authentication')
  return createOpenAICompatible({
    name: 'github-copilot',
    baseURL: EXTERNAL_URLS.GITHUB_COPILOT_API,
    apiKey: config.apiKey,
    fetch: createCopilotFetch() as typeof globalThis.fetch,
  })
}

function createChatGPTProFactory(
  config: ResolvedAgentConfig,
): (modelId: string) => unknown {
  if (!config.apiKey)
    throw new Error('ChatGPT Plus/Pro requires OAuth authentication')
  return createOpenAI({
    apiKey: config.apiKey,
    fetch: createCodexFetch(config.accountId) as typeof globalThis.fetch,
  }).responses
}

function createAcpFactory(
  config: ResolvedAgentConfig,
): (modelId: string) => unknown {
  if (!config.acpAgentId) {
    throw new Error(
      'ACP provider requires acpAgentId — pick an ACP agent in the LLM settings.',
    )
  }
  // cwd resolution chain:
  //   1. chat composer's userWorkingDir (per-turn)
  //   2. per-provider acpDefaultCwd (set in /settings/ai)
  //   3. auto-scratch under ~/.browseros/acp-workspaces/<conversationId>/
  // The third level keeps zero-config chat working — most BrowserOS
  // chats are browser tasks where cwd is irrelevant; the agent
  // operates via the BrowserOS MCP, not via filesystem reads.
  const cwd =
    config.workingDir ??
    config.acpDefaultCwd ??
    ensureAcpScratchDir(config.conversationId)
  // Session key keeps state distinct per (agent, cwd, conversation) so
  // workspace switches inside a chat correctly fork sessions and
  // separate conversations don't bleed context.
  const sessionKey = `browseros::${config.acpAgentId}::${cwd}::${config.conversationId}`
  const permissionMode = config.acpPermissionMode ?? 'approve-reads'
  const provider = createAcpxProvider({
    agent: config.acpAgentId,
    cwd,
    sessionKey,
    permissionMode,
    nonInteractivePermissions: 'deny',
    mcpServers: [
      // ACP agents discover the BrowserOS browser-tool surface via
      // this single HTTP MCP server. Host-side AI SDK tools are
      // skipped for the ACP path (acpx-ai-provider doesn't plumb
      // them through), so this is the only seam by which ACP agents
      // gain access to BrowserOS capabilities.
      {
        type: 'http',
        name: 'browseros',
        url: getBrowserOSMcpUrl(),
      },
    ],
    // Build a fresh runtime per conversation so the agent-registry
    // overrides above actually apply. acpx-ai-provider's
    // `agentRegistryOverrides` is consumed during runtime
    // construction; passing a pre-built runtime would silently ignore
    // it. Trade-off: each conversation pays one runtime construction
    // cost (sub-second; no child processes spawned until first turn).
    agentRegistryOverrides: buildAgentRegistryOverrides(
      config.acpAgentId,
      permissionMode,
    ),
  })
  // ACP agents pick the model inside their own CLI; the modelId
  // argument is ignored. Wrap so the dispatch table's
  // `factory(config)(config.model)` call still type-checks.
  return () => provider.languageModel()
}

const PROVIDER_FACTORIES: Record<string, ProviderFactory> = {
  [LLM_PROVIDERS.ANTHROPIC]: createAnthropicFactory,
  [LLM_PROVIDERS.OPENAI]: createOpenAIFactory,
  [LLM_PROVIDERS.GOOGLE]: createGoogleFactory,
  [LLM_PROVIDERS.OPENROUTER]: createOpenRouterFactory,
  [LLM_PROVIDERS.AZURE]: createAzureFactory,
  [LLM_PROVIDERS.LMSTUDIO]: createLMStudioFactory,
  [LLM_PROVIDERS.OLLAMA]: createOllamaFactory,
  [LLM_PROVIDERS.BEDROCK]: createBedrockFactory,
  [LLM_PROVIDERS.BROWSEROS]: createBrowserOSFactory,
  [LLM_PROVIDERS.OPENAI_COMPATIBLE]: createOpenAICompatibleFactory,
  [LLM_PROVIDERS.MOONSHOT]: createMoonshotFactory,
  [LLM_PROVIDERS.CHATGPT_PRO]: createChatGPTProFactory,
  [LLM_PROVIDERS.GITHUB_COPILOT]: createGitHubCopilotFactory,
  [LLM_PROVIDERS.QWEN_CODE]: createQwenCodeFactory,
  [LLM_PROVIDERS.ACP]: createAcpFactory,
}

export function createLanguageModel(
  config: ResolvedAgentConfig,
): LanguageModel {
  const provider = config.provider as string
  const factory = PROVIDER_FACTORIES[provider]
  if (!factory) throw new Error(`Unknown provider: ${provider}`)
  return factory(config)(config.model) as LanguageModel
}
