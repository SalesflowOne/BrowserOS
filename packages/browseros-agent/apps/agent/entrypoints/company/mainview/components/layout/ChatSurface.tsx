// biome-ignore-all lint/nursery/noExcessiveLinesPerFile: ChatSurface owns the full live-chat surface — SSE subscription, eight picker setters, send / interrupt / scroll plumbing — and the setters are useCallback-stable so they have to live next to the thread/employee values they read. Splitting fragments the per-thread state machine.
// biome-ignore-all lint/complexity/noExcessiveCognitiveComplexity: same reason — the surface is the state machine

import {
  Conversation,
  ConversationContent,
  ConversationScrollButton,
} from '@company/components/ai-elements/conversation'
import { BrowserPane } from '@company/components/chat/BrowserPane'
import { ChatMessageRow } from '@company/components/chat/ChatMessageRow'
import {
  Composer,
  type ComposerHandle,
  type ComposerTuple,
} from '@company/components/chat/Composer'
import { EmployeeBusy } from '@company/components/chat/EmployeeBusy'
import {
  isBrowserosToolName,
  readPageIdFromAnyShape,
} from '@company/lib/browserosTools'
import {
  AGENT_CAPABILITIES,
  type AgentKind,
  isAgentKind,
} from '@company/lib/capabilities'
import { consumeFocusRequest } from '@company/lib/composerFocusSignal'
import type { Tint } from '@company/lib/tints'
import type { Status } from '@company/lib/types'
import { cn } from '@company/lib/utils'
import { useAppWindow } from '@company/modules/api/browseros.hooks'
import type { Employee } from '@company/modules/api/employees.hooks'
import { toastError } from '@company/modules/api/errorToast'
import {
  type ChatTurn,
  useThreadEventStream,
} from '@company/modules/api/threadEventStream'
import {
  type ThreadRow,
  useInterruptThread,
  useSeenThread,
  useSendThreadMessage,
  useUpdateThreadOverrides,
} from '@company/modules/api/threads.hooks'
import { useNavigate, useSearch } from '@tanstack/react-router'
import {
  type FC,
  useCallback,
  useDeferredValue,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react'
import type { BrowserTabAttachment } from '../../../shared/attachments'
import {
  DEFAULT_PERMISSION_MODE,
  type PermissionMode,
} from '../../../shared/permission'
import { DetailsPane } from './DetailsPane'

interface Props {
  employee: Employee
  thread: ThreadRow
}

function initialTuple(employee: Employee, thread: ThreadRow): ComposerTuple {
  const effectiveAgent =
    thread.agentKindOverride && isAgentKind(thread.agentKindOverride)
      ? thread.agentKindOverride
      : isAgentKind(employee.agentKind)
        ? employee.agentKind
        : 'claude'
  const caps = AGENT_CAPABILITIES[effectiveAgent]
  const effectiveModel =
    thread.modelIdOverride ??
    (employee.agentKind === effectiveAgent ? employee.modelId : null) ??
    caps.defaultModelId
  const effectiveEffort =
    thread.reasoningEffortOverride ??
    (employee.agentKind === effectiveAgent ? employee.reasoningEffort : null) ??
    caps.defaultEffort
  const effectiveWorkspace =
    thread.workspacePathOverride ?? employee.workspacePath ?? null
  return {
    agentKind: effectiveAgent,
    modelId: effectiveModel,
    reasoningEffort: effectiveEffort,
    workspacePath: effectiveWorkspace,
  }
}

export const ChatSurface: FC<Props> = ({ employee, thread }) => {
  const send = useSendThreadMessage()
  const persistOverrides = useUpdateThreadOverrides()
  const interrupt = useInterruptThread()
  const seen = useSeenThread()
  const { history, live, activeAssistant } = useThreadEventStream(thread.id)

  // Mark the thread read whenever the surface mounts for a new thread
  // — clears the rail's "attention" indicator. Idempotent on the
  // server side; fire-and-forget here, errors are non-load-bearing.
  // biome-ignore lint/correctness/useExhaustiveDependencies: only the thread id matters; the mutate ref is stable
  useEffect(() => {
    seen.mutate({ id: thread.id })
  }, [thread.id])
  const navigate = useNavigate()
  const search = useSearch({ strict: false }) as {
    details?: 'open'
    browser?: 'watching'
    msg?: string
  }
  const detailsOpen = search.details === 'open'
  const browserOpen = search.browser === 'watching'
  const searchMsg = search.msg
  const [mountedWithDeepLink] = useState(() => Boolean(search.msg))
  const deferredDetailsOpen = useDeferredValue(detailsOpen)
  const deferredBrowserOpen = useDeferredValue(browserOpen)
  const showDetailsPane = detailsOpen && deferredDetailsOpen && !browserOpen
  const showBrowserPane = browserOpen && deferredBrowserOpen
  const showRightPane = showDetailsPane || showBrowserPane

  const { agentKind, modelId, reasoningEffort, workspacePath } = initialTuple(
    employee,
    thread,
  )

  const isStreaming = Boolean(live) || send.isPending
  const appWindow = useAppWindow()

  const setBrowserOpen = useCallback(
    (open: boolean) => {
      void navigate({
        to: '.',
        search: (prev) => ({
          ...prev,
          browser: open ? ('watching' as const) : undefined,
        }),
      })
    },
    [navigate],
  )

  const closePane = useCallback(() => setBrowserOpen(false), [setBrowserOpen])
  // "Open in BrowserOS" no longer flips per-surface visibility — the
  // app-wide window-visibility toggle lives in the tray menu now. This
  // CTA is a placeholder for a future bring-to-front action.
  const openBrowserOs = useCallback(() => {
    toastError(
      new Error('Use the tray menu to show or hide the BrowserOS window.'),
      'BrowserOS visibility lives in the tray',
    )
  }, [])

  // Focus handoff: if we arrived here from NewThread.handleSubmit
  // (which raises the signal right before navigate()), the user's
  // cursor was in a textarea that just unmounted. Grab focus on this
  // surface's Composer so they can keep typing without clicking back
  // into the input. Empty-deps so it runs once per mount — every
  // other code path that lands on a ChatSurface (rail click,
  // refresh, deep link) won't have raised the signal, so this is a
  // no-op for them. StrictMode's double-invoked mount effect is
  // safe: consumeFocusRequest() clears the flag on first read.
  const composerRef = useRef<ComposerHandle>(null)
  useEffect(() => {
    if (consumeFocusRequest()) {
      composerRef.current?.focus()
    }
  }, [])

  const historyLen = history.length
  // biome-ignore lint/correctness/useExhaustiveDependencies: historyLen is the trigger that signals "history just grew, retry the query"
  useEffect(() => {
    if (!searchMsg) return
    const id = requestAnimationFrame(() => {
      const node = document.querySelector(
        `[data-turn-id="${CSS.escape(searchMsg)}"]`,
      )
      if (!(node instanceof HTMLElement)) return
      node.scrollIntoView({ behavior: 'smooth', block: 'center' })
      node.dataset.justJumped = 'true'
      setTimeout(() => {
        delete node.dataset.justJumped
      }, 1500)
      void navigate({
        to: '.',
        search: (prev: Record<string, unknown>) => ({
          ...prev,
          msg: undefined,
        }),
        replace: true,
      })
    })
    return () => cancelAnimationFrame(id)
  }, [searchMsg, historyLen, navigate])

  const closeDetails = useCallback(() => {
    void navigate({
      to: '.',
      search: (prev) => ({ ...prev, details: undefined }),
    })
  }, [navigate])

  // Use `send.mutateAsync` directly in the deps array instead of the
  // whole `send` result object — the result object is a new ref on
  // every mutation state change (e.g. isPending flipping when streaming
  // starts/ends), which would re-create handleSubmit and bust
  // Composer's memo on every text.delta. mutateAsync is reference-
  // stable across renders.
  const sendMutateAsync = send.mutateAsync
  // Derive the override fields inside the callback so handleSubmit's
  // identity doesn't change on every render (initialTuple builds a
  // fresh object each call). thread + employee refs only change on
  // cache refetch, never on text.delta, so Composer's memo holds
  // during streaming.
  const handleSubmit = useCallback(
    async (text: string, attachments: BrowserTabAttachment[]) => {
      const t = initialTuple(employee, thread)
      try {
        await sendMutateAsync({
          id: thread.id,
          text,
          attachments,
          agentKindOverride: t.agentKind,
          modelIdOverride: t.modelId,
          reasoningEffortOverride: t.reasoningEffort,
          workspacePathOverride: t.workspacePath,
        })
      } catch (err) {
        toastError(err, 'Could not send')
        // Re-throw so the Composer can restore the draft text — the
        // toast above is the user-facing signal; this throw is the
        // contract with the input.
        throw err
      }
    },
    [sendMutateAsync, thread, employee],
  )

  const employeeFace = useMemo(
    () => ({
      id: employee.id,
      monogram: employee.monogram,
      tint: employee.tint as Tint,
      status: employee.status as Status,
      name: employee.name,
    }),
    [
      employee.id,
      employee.monogram,
      employee.tint,
      employee.status,
      employee.name,
    ],
  )

  // Derive the indicator's overlay inputs from `live.parts`. Walk
  // backwards so a fresh tool call masks an older one still cleaning
  // up; treat anything pre-output as in-flight. A pending
  // PermissionPart wins outright (paused branch in selectVerb).
  const liveToolName: string | null = useMemo(() => {
    if (!live) return null
    for (let i = live.parts.length - 1; i >= 0; i -= 1) {
      const part = live.parts[i]
      if (
        part?.kind === 'tool' &&
        part.state !== 'output-available' &&
        part.state !== 'output-error'
      ) {
        return part.toolName
      }
    }
    return null
  }, [live])

  const paused: boolean = useMemo(() => {
    if (!live) return false
    return live.parts.some(
      (p) => p.kind === 'permission' && p.state === 'pending',
    )
  }, [live])

  // Same pattern as sendMutateAsync above — pull the stable `mutate`
  // reference out so the setters' deps don't pick up the changing
  // `persistOverrides` result object.
  const persistOverridesMutate = persistOverrides.mutate
  const interruptMutate = interrupt.mutate

  const handleStop = useCallback(() => {
    interruptMutate({ id: thread.id })
  }, [interruptMutate, thread.id])

  const setAgent = useCallback(
    (next: AgentKind) => {
      // Switching agent invalidates the model + effort selection — the
      // current values are addressed in the old agent's vocabulary and
      // don't exist on the new one. Reset to the new agent's defaults.
      const nextCaps = AGENT_CAPABILITIES[next]
      persistOverridesMutate({
        id: thread.id,
        agentKindOverride: next,
        modelIdOverride: nextCaps.defaultModelId,
        reasoningEffortOverride: nextCaps.defaultEffort,
      })
    },
    [persistOverridesMutate, thread.id],
  )

  const setModel = useCallback(
    (modelId: string) => {
      persistOverridesMutate({ id: thread.id, modelIdOverride: modelId })
    },
    [persistOverridesMutate, thread.id],
  )

  const setEffort = useCallback(
    (reasoningEffort: string) => {
      persistOverridesMutate({
        id: thread.id,
        reasoningEffortOverride: reasoningEffort,
      })
    },
    [persistOverridesMutate, thread.id],
  )

  const setWorkspace = useCallback(
    (workspacePath: string | null) => {
      persistOverridesMutate({
        id: thread.id,
        workspacePathOverride: workspacePath,
      })
    },
    [persistOverridesMutate, thread.id],
  )

  // Picker → PATCH the column. The threads route handler also pushes
  // the new mode into the live ChatSession so the next acpx callback
  // invocation reads through. Effective mode used for the picker's
  // value falls back to the settings default for legacy rows whose
  // column was null at create time.
  const permissionMode: PermissionMode =
    (thread.permissionMode as PermissionMode | null) ?? DEFAULT_PERMISSION_MODE
  const setPermissionModeOnThread = useCallback(
    (mode: PermissionMode) => {
      persistOverridesMutate({ id: thread.id, permissionMode: mode })
    },
    [persistOverridesMutate, thread.id],
  )

  return (
    <div
      className={cn(
        'grid h-full min-h-0',
        showRightPane
          ? 'xl:grid-cols-[minmax(0,1fr)_minmax(280px,320px)]'
          : 'xl:grid-cols-[minmax(0,1fr)]',
      )}
    >
      <div className="flex h-full min-h-0 flex-col bg-background">
        <Conversation
          className="min-h-0 flex-1"
          // Suppress StickToBottom's initial="smooth" mount scroll when
          // we landed via a search-palette deep-link. Otherwise the
          // library races the deep-link scrollIntoView: history streams
          // in via SSE, StickToBottom auto-pins to bottom on every
          // content-height growth, and the user briefly sees the
          // matched turn highlighted before being yanked to the latest
          // message. With initial=false, the first scroll lands on the
          // matched turn and stays there; once we scroll away from
          // bottom, StickToBottom's "user is at bottom" heuristic flips
          // false and it stops trying to pin.
          initial={mountedWithDeepLink ? false : 'smooth'}
        >
          <ConversationContent className="mx-auto w-full max-w-[760px] gap-6 px-6 py-6">
            {history.map((turn, idx) => (
              <ChatMessageRow
                key={turn.requestId}
                turn={turn}
                employee={employeeFace}
                threadId={thread.id}
                // A history row is "last" only when nothing's streaming;
                // once a live turn exists, the rail of historic cards
                // freezes and the live row owns the active card.
                isLastTurn={!live && idx === history.length - 1}
              />
            ))}
            {live ? (
              <ChatMessageRow
                key={live.requestId}
                turn={live}
                employee={employeeFace}
                threadId={thread.id}
                isLastTurn
              />
            ) : null}
            <EmployeeBusy
              isStreaming={isStreaming}
              employee={{
                name: employee.name,
                monogram: employee.monogram,
                tint: employee.tint as Tint,
                templateId: employee.templateId ?? null,
              }}
              startedAt={activeAssistant?.startedAt ?? 0}
              outputChars={activeAssistant?.liveOutputChars ?? 0}
              inputChars={activeAssistant?.approxInputChars}
              liveToolName={liveToolName}
              paused={paused}
            />
          </ConversationContent>
          <ConversationScrollButton />
        </Conversation>

        <Composer
          ref={composerRef}
          onSubmit={handleSubmit}
          onStop={handleStop}
          isStreaming={isStreaming}
          agentKind={agentKind}
          modelId={modelId}
          reasoningEffort={reasoningEffort}
          workspacePath={workspacePath}
          setAgent={setAgent}
          setModel={setModel}
          setEffort={setEffort}
          setWorkspace={setWorkspace}
          permissionMode={permissionMode}
          setPermissionMode={setPermissionModeOnThread}
          employeeName={employee.name}
          employeeSkillNames={employee.skills ?? []}
          surface="employee"
          surfaceId={employee.id}
        />
      </div>

      {showBrowserPane ? (
        <BrowserPane
          windowId={appWindow.data?.windowId ?? null}
          pageId={derivePaneTargetPageId(live, history)}
          streamingBlocked={isStreaming}
          onOpenBrowserOs={openBrowserOs}
          onClose={closePane}
        />
      ) : showDetailsPane ? (
        <DetailsPane employee={employee} onClose={closeDetails} />
      ) : null}
    </div>
  )
}

function derivePaneTargetPageId(
  live: ChatTurn | null,
  history: ChatTurn[],
): number | null {
  if (live) {
    const found = scanTurnForPageId(live)
    if (found !== null) return found
  }
  for (let i = history.length - 1; i >= 0; i--) {
    const turn = history[i]
    if (!turn) continue
    const found = scanTurnForPageId(turn)
    if (found !== null) return found
  }
  return null
}

function scanTurnForPageId(turn: ChatTurn): number | null {
  for (let i = turn.parts.length - 1; i >= 0; i--) {
    const part = turn.parts[i]
    if (!part || part.kind !== 'tool') continue
    if (!isBrowserosToolName(part.toolName)) continue
    // Creator tools (new_page) expose pageId on output; action tools
    // take it as input.page. ACPX flattens both to a JSON-blob string
    // so the helper handles object + JSON-string + prose-blob shapes.
    const fromOutput = readPageIdFromAnyShape(part.output)
    if (fromOutput !== null) return fromOutput
    const fromInput = readPageIdFromAnyShape(part.input)
    if (fromInput !== null) return fromInput
  }
  return null
}
