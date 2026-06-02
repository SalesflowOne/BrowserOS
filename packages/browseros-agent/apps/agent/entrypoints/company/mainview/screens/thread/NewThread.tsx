// biome-ignore-all lint/nursery/noExcessiveLinesPerFile: NewThread bundles the pre-creation surface (hero, starters grid, composer with picker setters, URL-staging handlers) plus the sub-components that read employee state inline. Splitting would either duplicate the employee/search wiring or fragment the create-then-navigate flow.

import { Avatar } from '@company/components/chat/Avatar'
import {
  Composer,
  type ComposerHandle,
  type ComposerTuple,
} from '@company/components/chat/Composer'
import {
  AGENT_CAPABILITIES,
  type AgentKind,
  isAgentKind,
} from '@company/lib/capabilities'
import {
  clearFocusRequest,
  requestFocus,
} from '@company/lib/composerFocusSignal'
import type { Tint } from '@company/lib/tints'
import type { Status } from '@company/lib/types'
import {
  type Employee,
  useEmployee,
  useEmployeesWithRecentThreads,
} from '@company/modules/api/employees.hooks'
import { toastError } from '@company/modules/api/errorToast'
import { queryClient } from '@company/modules/api/queryClient'
import { useSystemSettings } from '@company/modules/api/system.hooks'
import {
  useCreateThread,
  useSendThreadMessage,
  useThread,
} from '@company/modules/api/threads.hooks'
import { useNavigate, useSearch } from '@tanstack/react-router'
import { useCallback, useRef, useState } from 'react'
import type { BrowserTabAttachment } from '../../../shared/attachments'
import {
  DEFAULT_PERMISSION_MODE,
  isPermissionMode,
  type PermissionMode,
} from '../../../shared/permission'

interface Props {
  employeeId: string
}

export function NewThreadScreen({ employeeId }: Props) {
  const employee = useEmployee({ variables: { id: employeeId } })

  if (!employee.data) {
    return (
      <div className="flex h-full items-center justify-center text-muted-foreground text-sm">
        {employee.isLoading ? 'Loading…' : 'Employee not found.'}
      </div>
    )
  }

  // key on the body forces a fresh mount per employee — without it, the
  // draft + composer tuple (initialized from the first employee) leak
  // across to the next one because TanStack Router reuses the same
  // mounted NewThreadScreen between /e/A/new and /e/B/new.
  return <NewThreadBody key={employee.data.id} employee={employee.data} />
}

const NewThreadBody = ({ employee }: { employee: Employee }) => {
  const navigate = useNavigate()
  const search = useSearch({ strict: false }) as {
    permissionMode?: PermissionMode
  }
  const createThread = useCreateThread()
  const send = useSendThreadMessage()
  const composerRef = useRef<ComposerHandle>(null)
  const [tuple, setTuple] = useState<ComposerTuple>(() =>
    initialTupleForEmployee(employee),
  )

  // Only the create blocks the UI — send fires-and-forgets so the
  // destination ChatSurface renders the in-flight turn via SSE.
  const isStreaming = createThread.isPending

  // Use stable mutate references so handleSubmit doesn't get a new
  // identity every time mutation state changes (isPending flipping
  // would otherwise bust Composer.memo on each transition).
  const createThreadMutateAsync = createThread.mutateAsync
  const sendMutateAsync = send.mutateAsync
  const stagedPermissionMode = isPermissionMode(search.permissionMode)
    ? search.permissionMode
    : undefined
  // Picker displays the staged URL choice if set, otherwise the
  // settings default so the chip never shows an empty value before
  // the user has expressed a preference.
  const systemSettings = useSystemSettings()
  const settingsDefault = isPermissionMode(
    systemSettings.data?.defaultPermissionMode,
  )
    ? systemSettings.data.defaultPermissionMode
    : DEFAULT_PERMISSION_MODE
  const effectivePermissionMode: PermissionMode =
    stagedPermissionMode ?? settingsDefault

  const handleSubmit = useCallback(
    async (text: string, _attachments: BrowserTabAttachment[]) => {
      clearFocusRequest()
      let thread: Awaited<ReturnType<typeof createThreadMutateAsync>>
      try {
        thread = await createThreadMutateAsync({
          employeeId: employee.id,
          permissionMode: stagedPermissionMode,
        })
      } catch (err) {
        toastError(err, 'Could not start the thread')
        // Re-throw so Composer restores the draft text.
        throw err
      }

      // Seed the cache so the destination's useThread resolves
      // synchronously without an extra round-trip, and invalidate the
      // rail's employees+threads list so the new thread appears there.
      queryClient.setQueryData(useThread.getKey({ id: thread.id }), thread)
      queryClient.invalidateQueries({
        queryKey: useEmployeesWithRecentThreads.getKey(),
      })

      // Fire-and-forget the first send. The server emits turn.start to
      // the events table immediately; the SSE stream on the destination
      // route replays it as soon as ChatSurface mounts. Surface errors
      // via toast — the new ChatSurface is now the right place to retry.
      void sendMutateAsync({
        id: thread.id,
        text,
        agentKindOverride: tuple.agentKind,
        modelIdOverride: tuple.modelId,
        reasoningEffortOverride: tuple.reasoningEffort,
        workspacePathOverride: tuple.workspacePath,
      }).catch((err) => toastError(err, 'Send failed'))

      // Raise the focus signal before navigate(). NewThread's
      // textarea is about to unmount; the destination ChatSurface's
      // mount effect will consume the signal and focus its own
      // Composer so the user can keep typing without clicking back
      // into the input.
      requestFocus()
      void navigate({
        to: '/e/$employeeId/t/$threadId',
        params: { employeeId: employee.id, threadId: thread.id },
        replace: true,
      })
    },
    [
      stagedPermissionMode,
      createThreadMutateAsync,
      employee.id,
      navigate,
      sendMutateAsync,
      tuple,
    ],
  )

  const setAgent = useCallback((next: AgentKind) => {
    const caps = AGENT_CAPABILITIES[next]
    setTuple((t) => ({
      ...t,
      agentKind: next,
      modelId: caps.defaultModelId,
      reasoningEffort: caps.defaultEffort,
    }))
  }, [])

  const setModel = useCallback(
    (modelId: string) => setTuple((t) => ({ ...t, modelId })),
    [],
  )
  const setEffort = useCallback(
    (reasoningEffort: string) => setTuple((t) => ({ ...t, reasoningEffort })),
    [],
  )
  const setWorkspace = useCallback(
    (workspacePath: string | null) =>
      setTuple((t) => ({ ...t, workspacePath })),
    [],
  )

  // Picker change on the new-thread surface stages the choice into
  // the URL search params; the POST /threads handler picks it up
  // when the first message is sent and snapshots it onto the row.
  // We don't materialise a row until then — the URL is the only
  // place this lives pre-creation.
  const setPermissionMode = useCallback(
    (mode: PermissionMode) => {
      void navigate({
        to: '/e/$employeeId/new',
        params: { employeeId: employee.id },
        search: { ...search, permissionMode: mode },
      })
    },
    [employee.id, navigate, search],
  )

  return (
    <div className="flex h-full min-h-0 flex-col bg-background">
      <div className="min-h-0 flex-1 overflow-y-auto">
        <div className="mx-auto flex w-full max-w-[640px] flex-col gap-6 px-6 py-10">
          <Hero employee={employee} />
          <Starters
            employee={employee}
            disabled={isStreaming}
            onPick={(s) => composerRef.current?.seed(s)}
          />
        </div>
      </div>
      <Composer
        ref={composerRef}
        onSubmit={handleSubmit}
        isStreaming={isStreaming}
        agentKind={tuple.agentKind}
        modelId={tuple.modelId}
        reasoningEffort={tuple.reasoningEffort}
        workspacePath={tuple.workspacePath}
        setAgent={setAgent}
        setModel={setModel}
        setEffort={setEffort}
        setWorkspace={setWorkspace}
        permissionMode={effectivePermissionMode}
        setPermissionMode={setPermissionMode}
        employeeName={employee.name}
        employeeSkillNames={employee.skills ?? []}
        surface="employee"
        surfaceId={employee.id}
      />
    </div>
  )
}

const Hero = ({ employee }: { employee: Employee }) => (
  <header className="flex flex-col gap-4">
    <div className="flex items-center gap-4">
      <Avatar
        monogram={employee.monogram}
        tint={employee.tint as Tint}
        status={employee.status as Status}
        size="lg"
      />
      <div className="min-w-0">
        <h1 className="font-semibold text-2xl tracking-tight">
          {employee.name}
        </h1>
        <p className="text-muted-foreground text-sm">{employee.role}</p>
      </div>
    </div>
    {employee.tagline ? (
      <p className="text-[15px] text-foreground/90">{employee.tagline}</p>
    ) : null}
    {employee.bio ? (
      <p className="text-muted-foreground text-sm leading-relaxed">
        {employee.bio}
      </p>
    ) : null}
  </header>
)

const Starters = ({
  employee,
  disabled,
  onPick,
}: {
  employee: Employee
  disabled: boolean
  onPick: (s: string) => void
}) => {
  const items = startersFor(employee.role)
  if (items.length === 0) return null
  return (
    <section className="flex flex-col gap-2">
      <p className="text-[10.5px] text-muted-foreground/70 uppercase tracking-[0.16em]">
        Try asking
      </p>
      <ul className="flex flex-col gap-2">
        {items.map((s) => (
          <li key={s}>
            <button
              type="button"
              disabled={disabled}
              onClick={() => onPick(s)}
              className="w-full rounded-md border border-border/60 bg-card/40 px-3 py-2 text-left text-foreground/90 text-sm transition-colors hover:bg-accent/40 hover:text-foreground disabled:cursor-not-allowed disabled:opacity-60"
            >
              {s}
            </button>
          </li>
        ))}
      </ul>
    </section>
  )
}

// Suggested first prompts keyed off the employee's `role`. Co-located
// with the screen so heuristics can evolve without a schema change;
// promote to per-template `starters[]` on `HIRE_TEMPLATES` once the
// shape settles.
function startersFor(role: string): string[] {
  const r = role.toLowerCase()
  if (r.includes('engineer') || r.includes('developer'))
    return [
      'Review the most recent PR for backwards-compat risks',
      'Run the full test suite and tell me which tests are flaky',
      'Refactor the highest-complexity file you can find and explain the change',
    ]
  if (r.includes('marketer'))
    return [
      'Draft three launch tweets for our latest release',
      'Sketch a 4-email onboarding sequence',
      'Propose a small experiment to lift signup conversion',
    ]
  if (r.includes('researcher') || r.includes('analyst'))
    return [
      'Brief me on the competitive landscape in this market',
      'Find three primary sources on a topic and summarise them',
      "Compile a one-pager on a company for tomorrow's call",
    ]
  if (r.includes('staff') || r.includes('chief'))
    return [
      'Triage my inbox for the next hour',
      'Draft replies to anything tagged urgent',
      "Summarise yesterday's meeting notes into action items",
    ]
  if (r.includes('recruiter') || r.includes('sourcer'))
    return [
      'Source 5 senior backend candidates in EU timezones',
      'Draft a personalized outreach for a hard-to-reach lead',
      "Build a structured interview rubric for this week's panel",
    ]
  if (r.includes('designer'))
    return [
      'Critique the latest screen and surface 3 specific fixes',
      'Sketch 3 hero variants for the landing page',
      'Audit the design tokens against the new brand palette',
    ]
  return [
    'What can you help me with?',
    'What context do you need from me first?',
    'Walk me through what you usually do day-to-day',
  ]
}

function initialTupleForEmployee(employee: Employee): ComposerTuple {
  const effectiveAgent = isAgentKind(employee.agentKind)
    ? employee.agentKind
    : 'claude'
  const caps = AGENT_CAPABILITIES[effectiveAgent]
  return {
    agentKind: effectiveAgent,
    modelId: employee.modelId ?? caps.defaultModelId,
    reasoningEffort: employee.reasoningEffort ?? caps.defaultEffort,
    workspacePath: employee.workspacePath ?? null,
  }
}
