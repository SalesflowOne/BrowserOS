import { getAgentServerUrl } from '../browseros/helpers'
import type { LlmProviderConfig } from './types'

/**
 * Wire shape of the `/migrations/llm-providers` endpoint payload. The
 * server-side type lives in
 * `apps/server/src/api/services/migrations/buildHarnessProviderCandidates.ts`.
 */
interface HarnessProviderCandidate {
  id: string
  type: 'claude-code' | 'codex'
  name: string
  modelId: string
  reasoningEffort?: 'none' | 'low' | 'medium' | 'high'
  acpAgentId: 'claude' | 'codex'
}

interface MigrationResponse {
  candidates: HarnessProviderCandidate[]
}

const CLAUDE_CONTEXT_WINDOW = 200000
const CODEX_CONTEXT_WINDOW = 400000

function homeDirFromEnv(): string {
  // The renderer lives in an extension, so we cannot read $HOME directly.
  // We stash a literal `$HOME` token and the server expands it inside
  // createAcpLanguageModel via expandHomeToken() before the path reaches
  // child_process.spawn (which does not expand shell variables in cwd).
  return '$HOME/browseros-workspaces'
}

function candidateToProvider(
  candidate: HarnessProviderCandidate,
  now: number,
): LlmProviderConfig {
  const contextWindow =
    candidate.type === 'codex' ? CODEX_CONTEXT_WINDOW : CLAUDE_CONTEXT_WINDOW
  return {
    id: candidate.id,
    type: candidate.type,
    name: candidate.name,
    modelId: candidate.modelId,
    supportsImages: true,
    contextWindow,
    temperature: 0.7,
    createdAt: now,
    updatedAt: now,
    reasoningEffort: candidate.reasoningEffort,
    acpAgentId: candidate.acpAgentId,
    acpFixedWorkspacePath: `${homeDirFromEnv()}/${candidate.id}`,
  }
}

export interface ImportHarnessProvidersResult {
  /** Provider records added in this pass (already deduped against `existing`). */
  added: LlmProviderConfig[]
  /** Candidates that matched an existing id and were skipped. */
  skipped: number
  /** Whether the endpoint returned at least one candidate. */
  hadCandidates: boolean
  /**
   * Whether the migration endpoint responded at all (any HTTP status,
   * any payload shape, parsed JSON). The caller uses this to decide
   * whether to finalize the migration flag on a fresh install with
   * zero harness rows: a reachable+empty response is the steady state,
   * an unreachable boot should retry on the next mount.
   */
  serverReachable: boolean
}

/**
 * Fetch the migration candidates and fold them into the provider list
 * passed in. Pure function; the caller decides whether to persist.
 * Returns the original list untouched when there are zero new entries.
 */
export interface ImportHarnessProvidersOptions {
  now?: () => number
  fetchImpl?: typeof fetch
  /**
   * Override for the agent server base URL. Defaults to
   * `getAgentServerUrl()`; tests pass a literal string to avoid having
   * to mock the helpers module (which leaks across test files).
   */
  agentServerUrl?: string | (() => Promise<string>)
}

async function resolveServerUrl(
  override: ImportHarnessProvidersOptions['agentServerUrl'],
): Promise<string> {
  if (override == null) return await getAgentServerUrl()
  if (typeof override === 'string') return override
  return await override()
}

export async function importHarnessProviders(
  existing: ReadonlyArray<LlmProviderConfig>,
  options?: ImportHarnessProvidersOptions,
): Promise<ImportHarnessProvidersResult> {
  const now = options?.now ?? Date.now
  const fetchImpl = options?.fetchImpl ?? fetch
  const serverUrl = await resolveServerUrl(options?.agentServerUrl)
  let response: Response
  try {
    response = await fetchImpl(`${serverUrl}/migrations/llm-providers`)
  } catch {
    return {
      added: [],
      skipped: 0,
      hadCandidates: false,
      serverReachable: false,
    }
  }
  if (!response.ok) {
    return {
      added: [],
      skipped: 0,
      hadCandidates: false,
      serverReachable: false,
    }
  }
  const payload = (await response.json()) as MigrationResponse
  const candidates = payload?.candidates ?? []
  if (candidates.length === 0) {
    return {
      added: [],
      skipped: 0,
      hadCandidates: false,
      serverReachable: true,
    }
  }
  const existingIds = new Set(existing.map((p) => p.id))
  const added: LlmProviderConfig[] = []
  let skipped = 0
  const nowValue = now()
  for (const candidate of candidates) {
    if (existingIds.has(candidate.id)) {
      skipped += 1
      continue
    }
    added.push(candidateToProvider(candidate, nowValue))
  }
  return { added, skipped, hadCandidates: true, serverReachable: true }
}
