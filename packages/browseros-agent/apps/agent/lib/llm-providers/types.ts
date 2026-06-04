/**
 * Backend-aligned provider types (matches AIProvider enum in backend)
 * @public
 */
export type ProviderType =
  | 'anthropic'
  | 'openai'
  | 'openai-compatible'
  | 'google'
  | 'openrouter'
  | 'azure'
  | 'ollama'
  | 'lmstudio'
  | 'bedrock'
  | 'browseros'
  | 'moonshot'
  | 'chatgpt-pro'
  | 'github-copilot'
  | 'qwen-code'
  | 'claude-code'
  | 'codex'
  | 'acp-custom'

/**
 * LLM Provider configuration
 * @public
 */
export interface LlmProviderConfig {
  /** Unique identifier for the provider */
  id: string
  /** Provider type/template */
  type: ProviderType
  /** Display name for the provider */
  name: string
  /** Base API URL (optional for Azure with resourceName, not used for Bedrock) */
  baseUrl?: string
  /** Model identifier */
  modelId: string
  /** API key (encrypted and stored locally) */
  apiKey?: string
  /** Whether this provider supports image inputs */
  supportsImages: boolean
  /** Context window size (number of tokens) */
  contextWindow: number
  /** Temperature for model sampling (0-2) */
  temperature: number
  /** Timestamp when created */
  createdAt: number
  /** Timestamp when last updated */
  updatedAt: number

  // Azure-specific fields
  /** Azure OpenAI resource name (used to construct URL if baseUrl not provided) */
  resourceName?: string

  // Bedrock-specific fields
  /** AWS access key ID */
  accessKeyId?: string
  /** AWS secret access key */
  secretAccessKey?: string
  /** AWS region (e.g., us-east-1) */
  region?: string
  /** AWS session token (for temporary STS credentials) */
  sessionToken?: string

  // ChatGPT Pro (Codex) fields
  reasoningEffort?: 'none' | 'low' | 'medium' | 'high'
  reasoningSummary?: 'auto' | 'concise' | 'detailed'

  // ACP-backed providers (claude-code, codex, acp-custom). agent id
  // resolves through acpx's registry; command is only used when
  // type === 'acp-custom'; workspace is the fixed-path cwd the user
  // picks at provider-create time.
  acpAgentId?: string
  acpCommand?: string
  acpFixedWorkspacePath?: string
}

/**
 * Schema for LLM provider config stored in BrowserOS prefs (browseros.providers)
 * @public
 */
export interface LlmProvidersBackup {
  defaultProviderId: string
  providers: LlmProviderConfig[]
}
