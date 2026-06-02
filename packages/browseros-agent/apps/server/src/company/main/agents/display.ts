export interface AgentDisplay {
  agentId: string
  label: string
  description: string
  monogram: string
  installUrl: string
}

// Curated display copy for the agents we've actually exercised. Unknown
// ids — anything acpx adds upstream that we haven't documented — fall
// through to a generic shape that still renders sanely in the UI.
const DISPLAY: Record<string, AgentDisplay> = {
  claude: {
    agentId: 'claude',
    label: 'Claude Code',
    description:
      'Anthropic Claude with the Claude Code CLI as the ACP runtime.',
    monogram: 'C',
    installUrl: 'https://github.com/anthropics/claude-code#get-started',
  },
  codex: {
    agentId: 'codex',
    label: 'Codex CLI',
    description: 'OpenAI agent CLI speaking ACP.',
    monogram: 'X',
    installUrl: 'https://developers.openai.com/codex/cli#cli-setup',
  },
  gemini: {
    agentId: 'gemini',
    label: 'Gemini CLI',
    description: "Google's Gemini CLI agent.",
    monogram: 'G',
    installUrl: 'https://github.com/google-gemini/gemini-cli',
  },
  hermes: {
    agentId: 'hermes',
    label: 'Hermes',
    description: 'Open-source ACP agent.',
    monogram: 'H',
    installUrl: 'https://github.com/openclaw/hermes',
  },
}

const GENERIC_INSTALL_URL = 'https://github.com/openclaw/acpx'

export function displayFor(agentId: string): AgentDisplay {
  const entry = DISPLAY[agentId]
  if (entry) return entry
  return {
    agentId,
    label: agentId,
    description: '',
    monogram: agentId.slice(0, 1).toUpperCase() || '?',
    installUrl: GENERIC_INSTALL_URL,
  }
}
