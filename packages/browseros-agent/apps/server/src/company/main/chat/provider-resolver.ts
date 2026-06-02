import type { AcpxProvider } from 'acpx-ai-provider'
import { capabilitiesFor } from '../../shared/agents/capabilities.constants.js'
import type { ChatTuple } from './tuple.js'

// Resolves a tuple's nullable fields into concrete values the acpx
// provider expects. Falls back to per-agent defaults from the
// capability constants module.
export interface ResolvedTuple extends ChatTuple {
  modelId: string
  reasoningEffort: NonNullable<ChatTuple['reasoningEffort']>
}

export function resolveTuple(t: ChatTuple): ResolvedTuple {
  const caps = capabilitiesFor(t.agentKind)
  const fallbackEffort =
    (caps.defaultEffort as ChatTuple['reasoningEffort']) ?? 'medium'
  return {
    agentKind: t.agentKind,
    modelId: t.modelId ?? caps.defaultModelId,
    workspacePath: t.workspacePath,
    reasoningEffort: t.reasoningEffort ?? fallbackEffort,
  }
}

/**
 * Apply the per-session ACP config a freshly-built `AcpxProvider`
 * needs before its first turn:
 *
 *   1. `setMode(<defaultPermissionMode>)` — hard-locks the agent's
 *      permission preset per `capabilities.constants.ts`.
 *   2. `setConfigOption('model', tuple.modelId)` — when a non-default
 *      model is chosen.
 *   3. `setConfigOption(effortConfigId, tuple.reasoningEffort)` — only
 *      when the agent supports config options at all (gemini does not).
 *
 * Each call is independently wrapped in try/catch; a failure here is
 * non-fatal — the agent keeps its own defaults and the turn proceeds.
 */
export async function bootstrapNewProvider(
  provider: AcpxProvider,
  tuple: ChatTuple,
): Promise<void> {
  await provider.prepare()
  const caps = capabilitiesFor(tuple.agentKind)
  try {
    await provider.setMode(caps.defaultPermissionMode)
  } catch (err) {
    // biome-ignore lint/suspicious/noConsole: non-fatal — agent uses its default mode
    console.warn(
      `[provider-resolver] setMode(${caps.defaultPermissionMode}) failed for ${tuple.agentKind}:`,
      err,
    )
  }
  if (tuple.modelId) {
    // TODO(gemini-model-selection): for gemini this call fails with
    // ACP -32601 because gemini's adapter doesn't implement
    // `session/set_config_option` — only the dedicated
    // `session/set_model` wire method. acpx-ai-provider@0.0.4 doesn't
    // expose a `setModel` API yet, so we can't route through the
    // working path. The try/catch absorbs the failure and gemini stays
    // on its default model; users see the picker reflect their choice
    // persistently (we record it on the thread row) but the agent
    // never actually switches. Follow-up: upstream a `setModel` method
    // to acpx-ai-provider that calls `runtime.setSessionModel`, then
    // dispatch here based on `caps.supportsConfigOption`.
    try {
      await provider.setConfigOption('model', tuple.modelId)
    } catch (err) {
      // biome-ignore lint/suspicious/noConsole: non-fatal — agent uses its default model
      console.warn(
        `[provider-resolver] setConfigOption(model=${tuple.modelId}) failed:`,
        err,
      )
    }
  }
  if (
    caps.supportsConfigOption &&
    caps.effortConfigId &&
    tuple.reasoningEffort &&
    tuple.reasoningEffort !== 'none'
  ) {
    try {
      await provider.setConfigOption(caps.effortConfigId, tuple.reasoningEffort)
    } catch (err) {
      // biome-ignore lint/suspicious/noConsole: non-fatal — agent uses its default effort
      console.warn(
        `[provider-resolver] setConfigOption(${caps.effortConfigId}=${tuple.reasoningEffort}) failed:`,
        err,
      )
    }
  }
}

/**
 * Apply a config-only delta to a live `AcpxProvider`. Called when the
 * tuple changed but the provider key (`agentKind`+`workspacePath`)
 * stayed the same — the agent process is still running, we just need
 * to nudge its model or effort for subsequent turns. Sends only the
 * RPCs for fields that actually changed.
 *
 * Caller must have verified `providerKeyEqual(oldTuple, newTuple)`
 * already; this helper does not double-check.
 */
export async function applyConfigDelta(
  provider: AcpxProvider,
  oldTuple: ChatTuple,
  newTuple: ChatTuple,
): Promise<void> {
  const caps = capabilitiesFor(newTuple.agentKind)
  if (newTuple.modelId && newTuple.modelId !== oldTuple.modelId) {
    try {
      await provider.setConfigOption('model', newTuple.modelId)
    } catch (err) {
      // biome-ignore lint/suspicious/noConsole: non-fatal — see bootstrapNewProvider
      console.warn(
        `[provider-resolver] in-place setConfigOption(model=${newTuple.modelId}) failed:`,
        err,
      )
    }
  }
  if (
    caps.supportsConfigOption &&
    caps.effortConfigId &&
    newTuple.reasoningEffort &&
    newTuple.reasoningEffort !== 'none' &&
    newTuple.reasoningEffort !== oldTuple.reasoningEffort
  ) {
    try {
      await provider.setConfigOption(
        caps.effortConfigId,
        newTuple.reasoningEffort,
      )
    } catch (err) {
      // biome-ignore lint/suspicious/noConsole: non-fatal — see bootstrapNewProvider
      console.warn(
        `[provider-resolver] in-place setConfigOption(${caps.effortConfigId}=${newTuple.reasoningEffort}) failed:`,
        err,
      )
    }
  }
}
