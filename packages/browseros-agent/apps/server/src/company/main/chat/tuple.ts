import type { Employee } from '../../db/schema/employees.sql.js'
import type { Thread } from '../../db/schema/threads.sql.js'

// Tuple of per-turn agent configuration. Same shape whether the source
// is the employee row (default) or a thread-level override.
export interface ChatTuple {
  agentKind: Employee['agentKind']
  modelId: string | null
  workspacePath: string | null
  reasoningEffort: Employee['reasoningEffort']
}

export function tupleFromEmployee(employee: Employee): ChatTuple {
  return {
    agentKind: employee.agentKind,
    modelId: employee.modelId,
    workspacePath: employee.workspacePath,
    reasoningEffort: employee.reasoningEffort,
  }
}

// Effective tuple for a thread: thread-level overrides win, employee
// defaults fill in the rest. Used by the session manager to know which
// agent / model / cwd to spin a session with.
export function effectiveTuple(thread: Thread, employee: Employee): ChatTuple {
  const employeeTuple = tupleFromEmployee(employee)
  return {
    agentKind: thread.agentKindOverride ?? employeeTuple.agentKind,
    modelId: thread.modelIdOverride ?? employeeTuple.modelId,
    workspacePath: thread.workspacePathOverride ?? employeeTuple.workspacePath,
    reasoningEffort:
      (thread.reasoningEffortOverride as ChatTuple['reasoningEffort']) ??
      employeeTuple.reasoningEffort,
  }
}

export function tupleKey(t: ChatTuple): string {
  return [
    t.agentKind,
    t.modelId ?? '_',
    t.workspacePath ?? '_',
    t.reasoningEffort ?? '_',
  ].join('::')
}

/**
 * True when both tuples target the same ACP child process — same agent
 * binary, same workspace cwd. Used to decide whether a tuple change
 * can be applied in-place (setConfigOption RPC on the live provider)
 * or requires disposing and rebuilding the provider with a full
 * transcript replay.
 */
export function providerKeyEqual(
  a: ChatTuple | null,
  b: ChatTuple | null,
): boolean {
  if (a === b) return true
  if (!a || !b) return false
  return a.agentKind === b.agentKind && a.workspacePath === b.workspacePath
}

/**
 * True when every tuple field matches. False but `providerKeyEqual`
 * true means a config-only change (modelId or reasoningEffort) —
 * the provider stays alive; only the changed setConfigOption fires.
 */
export function tuplesEqual(a: ChatTuple | null, b: ChatTuple | null): boolean {
  if (a === b) return true
  if (!a || !b) return false
  return (
    a.agentKind === b.agentKind &&
    a.modelId === b.modelId &&
    a.workspacePath === b.workspacePath &&
    a.reasoningEffort === b.reasoningEffort
  )
}
