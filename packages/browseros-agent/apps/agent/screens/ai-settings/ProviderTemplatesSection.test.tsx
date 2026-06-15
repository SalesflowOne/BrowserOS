import { beforeAll, describe, expect, it, mock } from 'bun:test'
import { type ComponentProps, createElement, type FC } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import type {
  HarnessAdapterDescriptor,
  HarnessAgentAdapter,
} from '@/modules/agents/agent-harness-types'

type ProviderTemplatesSectionProps = {
  codingAdapters: HarnessAdapterDescriptor[]
  onCreateAgent: (adapterId: HarnessAgentAdapter) => void
  onUseTemplate: () => void
}

type ButtonishProps = ComponentProps<'button'> & {
  asChild?: boolean
}

const featureNames = [
  'ALPHA_FEATURES_SUPPORT',
  'OPENAI_COMPATIBLE_SUPPORT',
  'MANAGED_MCP_SUPPORT',
  'PERSONALIZATION_SUPPORT',
  'CUSTOMIZATION_SUPPORT',
  'WORKSPACE_FOLDER_SUPPORT',
  'PROXY_SUPPORT',
  'PREVIOUS_CONVERSATION_ARRAY',
  'NEWTAB_CHAT_SUPPORT',
  'VERTICAL_TABS_SUPPORT',
  'CHATGPT_PRO_SUPPORT',
  'GITHUB_COPILOT_SUPPORT',
  'QWEN_CODE_SUPPORT',
  'CREDITS_SUPPORT',
  'AGENT_HARNESS_SUPPORT',
  'HERMES_AGENT_SUPPORT',
] as const

const Feature = Object.fromEntries(
  featureNames.map((feature) => [feature, feature]),
)

mock.module('@/lib/utils', () => ({
  cn: (...inputs: Array<string | false | null | undefined>) =>
    inputs.filter(Boolean).join(' '),
}))

mock.module('@/lib/browseros/capabilities', () => ({
  Feature,
  Capabilities: {
    getStaticSupport: () => null,
    getBrowserOSVersion: async () => null,
    getServerVersion: async () => null,
    supports: async () => false,
  },
}))

mock.module('@/lib/llm-providers/types', () => ({
  REMOTE_HERMES_PROVIDER_TYPE: 'remote-hermes',
}))

mock.module('@/lib/llm-providers/providerTemplates', () => ({
  providerTemplates: [
    {
      id: 'remote-hermes',
      name: 'Remote Hermes',
      defaultBaseUrl: '',
      defaultModelId: 'default',
      supportsImages: false,
      contextWindow: 200000,
    },
    {
      id: 'openai',
      name: 'OpenAI',
      defaultBaseUrl: 'https://api.openai.com/v1',
      defaultModelId: 'gpt-5',
      supportsImages: true,
      contextWindow: 128000,
    },
  ],
}))

mock.module('@/lib/llm-providers/provider-visibility', () => ({
  visibleProviderTemplates: (
    templates: Array<{ id: string }>,
    supports: (feature: string) => boolean,
  ) =>
    templates.filter(
      (template) =>
        template.id !== 'remote-hermes' || supports('HERMES_AGENT_SUPPORT'),
    ),
}))

mock.module('@/modules/browseros/capabilities.hooks', () => ({
  useCapabilities: () => ({
    supports: (feature: string) => feature !== 'HERMES_AGENT_SUPPORT',
    isLoading: false,
  }),
}))

mock.module('@/components/ui/badge', () => ({
  Badge: ({ children }: { children?: unknown }) =>
    createElement('span', null, children as never),
}))

mock.module('@/components/ui/collapsible', () => ({
  Collapsible: ({ children }: ComponentProps<'div'>) =>
    createElement('div', null, children),
  CollapsibleContent: ({ children }: ComponentProps<'div'>) =>
    createElement('div', null, children),
  CollapsibleTrigger: ({ children, ...props }: ButtonishProps) =>
    createElement('button', { type: 'button', ...props }, children),
}))

mock.module('@/lib/llm-providers/providerIcons', () => ({
  ProviderIcon: ({ type }: { type: string }) =>
    createElement('span', null, type),
}))

mock.module('@/components/agents/AdapterIcon', () => ({
  AdapterIcon: ({ adapter }: { adapter: string }) =>
    createElement(
      'span',
      {
        'aria-label':
          adapter === 'codex'
            ? 'Codex'
            : adapter === 'claude'
              ? 'Claude Code'
              : 'Agent',
      },
      null,
    ),
  adapterLabel: (adapter: string) =>
    adapter === 'codex'
      ? 'Codex'
      : adapter === 'claude'
        ? 'Claude Code'
        : 'Agent',
}))

let ProviderTemplatesSection: FC<ProviderTemplatesSectionProps>

beforeAll(async () => {
  ProviderTemplatesSection = (await import('./ProviderTemplatesSection'))
    .ProviderTemplatesSection
})

function makeAdapter(id: HarnessAgentAdapter): HarnessAdapterDescriptor {
  return {
    id,
    name: id === 'codex' ? 'Codex' : 'Claude Code',
    defaultModelId: 'model',
    defaultReasoningEffort: 'medium',
    modelControl: 'best-effort',
    models: [],
    reasoningEfforts: [],
  }
}

function renderSection() {
  return renderToStaticMarkup(
    createElement(ProviderTemplatesSection, {
      codingAdapters: [makeAdapter('claude'), makeAdapter('codex')],
      onCreateAgent: () => {},
      onUseTemplate: () => {},
    }),
  )
}

describe('ProviderTemplatesSection', () => {
  it('hides Remote Hermes without dropping coding-agent templates', () => {
    const html = renderSection()

    expect(html).not.toContain('Remote Hermes')
    expect(html).toContain('Claude Code')
    expect(html).toContain('Codex')
  })
})
