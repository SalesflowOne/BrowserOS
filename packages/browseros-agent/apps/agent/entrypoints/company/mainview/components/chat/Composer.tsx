// biome-ignore-all lint/nursery/noExcessiveLinesPerFile: composer + skill-picker + tab-picker glue is one coherent surface; splitting hurts readability more than the line count helps

import { AgentPicker } from '@company/components/chat/AgentPicker'
import { ComposerWorkspacePicker } from '@company/components/chat/ComposerWorkspacePicker'
import { ModelEffortPicker } from '@company/components/chat/ModelEffortPicker'
import { PermissionPicker } from '@company/components/chat/PermissionPicker'
import { SkillPicker } from '@company/components/chat/SkillPicker'
import { TabChipRow } from '@company/components/chat/TabChipRow'
import { TabPicker } from '@company/components/chat/TabPicker'
import { VoiceButton } from '@company/components/chat/VoiceButton'
import { AGENT_CAPABILITIES, type AgentKind } from '@company/lib/capabilities'
import { cn } from '@company/lib/utils'
import { useBrowserTabs } from '@company/modules/api/browseros.hooks'
import {
  useBuiltInSkills,
  useExternalSkills,
  useSkills,
} from '@company/modules/api/skills.hooks'
import { ArrowUp, Plus, Square } from 'lucide-react'
import type { CSSProperties, KeyboardEvent } from 'react'
import {
  forwardRef,
  memo,
  useCallback,
  useEffect,
  useImperativeHandle,
  useMemo,
  useRef,
  useState,
} from 'react'
import type { BrowserTabAttachment } from '../../../shared/attachments'
import type { PermissionMode } from '../../../shared/permission'

export interface ComposerTuple {
  agentKind: AgentKind
  modelId: string
  reasoningEffort: string | null
  workspacePath: string | null
}

interface Props {
  onSubmit: (
    text: string,
    attachments: BrowserTabAttachment[],
  ) => Promise<void> | void
  onStop?: () => void
  isStreaming: boolean
  // The composer's per-thread selection arrives as four primitive
  // props rather than a `ComposerTuple` object so React.memo's shallow
  // compare stays valid across renders where the parent rebuilds the
  // tuple object (e.g. ChatSurface re-renders on every text.delta).
  // Primitive-equality is stable; object-identity is not.
  agentKind: AgentKind
  modelId: string
  reasoningEffort: string | null
  workspacePath: string | null
  setAgent: (next: AgentKind) => void
  setModel: (id: string) => void
  setEffort: (effort: string) => void
  setWorkspace: (path: string | null) => void
  permissionMode: PermissionMode
  setPermissionMode: (mode: PermissionMode) => void
  employeeName: string
  employeeSkillNames: string[]
  /** Identifies the BrowserOS window the @-tab picker should list. */
  surface: 'employee' | 'channel'
  surfaceId: string
}

export interface ComposerHandle {
  seed: (text: string) => void
  focus: () => void
}

const AUTOGROW_STYLE: CSSProperties = {
  fieldSizing: 'content',
  minHeight: '1.5rem',
  maxHeight: '12rem',
} as CSSProperties

const SKILL_TOKEN = /(^|\s)[/$]\S*$/
const TAB_TOKEN = /(^|\s)@(\S*)$/

type ActivePicker =
  | { kind: 'skill'; filter: string }
  | { kind: 'tab'; filter: string }
  | null

function detectActivePicker(draft: string): ActivePicker {
  const skill = /(^|\s)[/$](\S*)$/.exec(draft)
  if (skill) return { kind: 'skill', filter: skill[2] ?? '' }
  const tab = TAB_TOKEN.exec(draft)
  if (tab) return { kind: 'tab', filter: tab[2] ?? '' }
  return null
}

export const Composer = memo(
  // biome-ignore lint/complexity/noExcessiveCognitiveComplexity: composer wires together two pickers, chip row, attachments state and skill state — extracting further makes the wiring harder to follow
  forwardRef<ComposerHandle, Props>(function Composer(
    {
      onSubmit,
      onStop,
      isStreaming,
      agentKind,
      modelId,
      reasoningEffort,
      workspacePath,
      setAgent,
      setModel,
      setEffort,
      setWorkspace,
      permissionMode,
      setPermissionMode,
      employeeName,
      employeeSkillNames,
      surface,
      surfaceId,
    },
    ref,
  ) {
    const textareaRef = useRef<HTMLTextAreaElement | null>(null)
    const [draft, setDraft] = useState('')
    const [attachments, setAttachments] = useState<BrowserTabAttachment[]>([])
    const picker = detectActivePicker(draft)
    const pickerOpen = picker !== null
    const skillPrefix = AGENT_CAPABILITIES[agentKind].skillCommandPrefix

    const [pickerIndex, setPickerIndex] = useState(0)

    // biome-ignore lint/correctness/useExhaustiveDependencies: picker.kind/filter are intentional reset triggers, not referenced in the body
    useEffect(() => {
      setPickerIndex(0)
    }, [picker?.kind, picker?.filter])

    const { data: builtInsData, isPending: builtInsPending } =
      useBuiltInSkills()
    const { data: userSkillsData, isPending: userSkillsPending } = useSkills()
    const { data: externalSkillsData, isPending: externalSkillsPending } =
      useExternalSkills()
    const skillsLoading =
      builtInsPending || userSkillsPending || externalSkillsPending

    const tabsQuery = useBrowserTabs({
      variables: { surface, surfaceId },
      enabled: picker?.kind === 'tab',
    })

    const builtInSkills = (builtInsData?.skills ?? []).filter(
      (s) => !s.disabled && !s.broken,
    )
    const userSkills = (userSkillsData?.skills ?? []).filter(
      (s) => !s.disabled && !s.broken,
    )
    const externalSkills = externalSkillsData?.skills ?? []

    const skillFilter = picker?.kind === 'skill' ? picker.filter : ''
    const flatSkills = useMemo(
      () =>
        orderedSkills(
          builtInSkills,
          userSkills,
          externalSkills,
          employeeSkillNames,
          skillFilter,
        ),
      [
        builtInSkills,
        userSkills,
        externalSkills,
        employeeSkillNames,
        skillFilter,
      ],
    )

    const tabFilter = picker?.kind === 'tab' ? picker.filter : ''
    const visibleTabs = useMemo(() => {
      const all = tabsQuery.data?.tabs ?? []
      const lc = tabFilter.toLowerCase()
      if (!lc) return all
      return all.filter(
        (t) =>
          t.title.toLowerCase().includes(lc) ||
          t.url.toLowerCase().includes(lc),
      )
    }, [tabsQuery.data, tabFilter])

    const canSend =
      (draft.trim().length > 0 || attachments.length > 0) &&
      !isStreaming &&
      !pickerOpen

    useImperativeHandle(
      ref,
      () => ({
        seed: (text: string) => {
          setDraft(text)
          textareaRef.current?.focus()
        },
        focus: () => textareaRef.current?.focus(),
      }),
      [],
    )

    useEffect(() => {
      const el = textareaRef.current
      if (!el) return
      if (CSS.supports('field-sizing', 'content')) return
      el.style.height = 'auto'
      el.style.height = `${Math.min(el.scrollHeight, 192)}px`
    })

    const insertSkill = useCallback(
      (name: string) => {
        setDraft((d) => d.replace(SKILL_TOKEN, `$1${skillPrefix}${name} `))
        textareaRef.current?.focus()
      },
      [skillPrefix],
    )

    const insertTab = useCallback((tab: BrowserTabAttachment) => {
      setAttachments((prev) =>
        prev.some((p) => p.pageId === tab.pageId) ? prev : [...prev, tab],
      )
      setDraft((d) => d.replace(TAB_TOKEN, '$1'))
      textareaRef.current?.focus()
    }, [])

    const submit = useCallback(async () => {
      const text = draft.trim()
      if ((text.length === 0 && attachments.length === 0) || isStreaming) return
      const sentAttachments = attachments
      setDraft('')
      setAttachments([])
      try {
        await onSubmit(text, sentAttachments)
      } catch {
        setDraft(text)
        setAttachments(sentAttachments)
      }
    }, [draft, attachments, isStreaming, onSubmit])

    const onKeyDown = useCallback(
      (e: KeyboardEvent<HTMLTextAreaElement>) => {
        if (!picker) {
          if (e.key === 'Enter' && !e.shiftKey) {
            e.preventDefault()
            void submit()
          }
          return
        }
        if (picker.kind === 'skill') {
          handleSkillKey(e, {
            flat: flatSkills,
            index: pickerIndex,
            setIndex: setPickerIndex,
            onSelect: insertSkill,
            clearToken: () => setDraft((d) => d.replace(SKILL_TOKEN, '$1')),
          })
          return
        }
        handleTabKey(e, {
          tabs: visibleTabs,
          index: pickerIndex,
          setIndex: setPickerIndex,
          onSelect: insertTab,
          clearToken: () => setDraft((d) => d.replace(TAB_TOKEN, '$1')),
        })
      },
      [
        picker,
        pickerIndex,
        flatSkills,
        visibleTabs,
        insertSkill,
        insertTab,
        submit,
      ],
    )

    return (
      <div className="shrink-0 px-6 pt-2 pb-4">
        <div className="mx-auto max-w-[760px] space-y-2">
          <div className="relative">
            {picker?.kind === 'skill' && (
              <div className="absolute right-0 bottom-full left-0 z-50 mb-2">
                <SkillPicker
                  builtInSkills={builtInSkills}
                  userSkills={userSkills}
                  externalSkills={externalSkills}
                  employeeSkillNames={employeeSkillNames}
                  filter={picker.filter}
                  selectedIndex={pickerIndex}
                  loading={skillsLoading}
                  onSelect={insertSkill}
                  onHover={setPickerIndex}
                />
              </div>
            )}
            {picker?.kind === 'tab' && (
              <div className="absolute right-0 bottom-full left-0 z-50 mb-2">
                <TabPicker
                  tabs={tabsQuery.data?.tabs ?? []}
                  filter={picker.filter}
                  selectedIndex={pickerIndex}
                  loading={tabsQuery.isPending}
                  degraded={tabsQuery.data?.degraded === true}
                  degradedMessage={
                    tabsQuery.data?.degraded === true
                      ? tabsQuery.data.message
                      : undefined
                  }
                  onSelect={(t) =>
                    insertTab({
                      kind: 'browserTab',
                      pageId: t.pageId,
                      tabId: t.tabId,
                      url: t.url,
                      title: t.title,
                    })
                  }
                  onHover={setPickerIndex}
                />
              </div>
            )}
            <div
              className={cn(
                'rounded-[1.25rem] border border-border/60 bg-card transition-[border-color,box-shadow] duration-150',
                'focus-within:border-[color:var(--accent-orange)]/40',
                'focus-within:shadow-[0_0_0_4px_color-mix(in_oklch,var(--accent-orange)_15%,transparent)]',
              )}
            >
              <div className="px-3 pt-3">
                <TabChipRow
                  attachments={attachments}
                  onRemove={(pageId) =>
                    setAttachments((prev) =>
                      prev.filter((p) => p.pageId !== pageId),
                    )
                  }
                  disabled={isStreaming}
                />
              </div>
              <textarea
                ref={textareaRef}
                value={draft}
                onChange={(e) => setDraft(e.target.value)}
                onKeyDown={onKeyDown}
                placeholder={`Message ${employeeName}…`}
                rows={1}
                style={AUTOGROW_STYLE}
                className={cn(
                  'block w-full resize-none overflow-y-auto bg-transparent px-4 pt-1 pb-2 text-[14.5px] text-foreground outline-none placeholder:text-muted-foreground/70',
                )}
              />
              <div className="flex items-center justify-between gap-2 px-3 pt-1 pb-2">
                <div className="flex items-center gap-1.5">
                  <button
                    type="button"
                    aria-label="Attach"
                    title="Type @ to attach a browser tab"
                    disabled
                    className={cn(
                      'inline-flex size-7 shrink-0 items-center justify-center rounded-md text-muted-foreground/60 transition-colors',
                      'hover:bg-accent hover:text-foreground disabled:cursor-not-allowed disabled:opacity-50',
                    )}
                  >
                    <Plus className="size-4" />
                  </button>
                </div>
                <div className="flex items-center gap-1.5">
                  <PermissionPicker
                    value={permissionMode}
                    onChange={setPermissionMode}
                    disabled={isStreaming}
                  />
                  <ModelEffortPicker
                    agentKind={agentKind}
                    modelId={modelId}
                    reasoningEffort={reasoningEffort}
                    onChangeModel={setModel}
                    onChangeEffort={setEffort}
                    disabled={isStreaming}
                  />
                  <VoiceButton />
                  <button
                    type="button"
                    onClick={isStreaming ? onStop : submit}
                    disabled={isStreaming ? !onStop : !canSend}
                    aria-label={isStreaming ? 'Stop' : 'Send'}
                    title={isStreaming ? 'Stop' : 'Send'}
                    className={cn(
                      'inline-flex size-7 shrink-0 items-center justify-center rounded-md transition-colors',
                      isStreaming
                        ? 'bg-muted text-muted-foreground hover:bg-muted/80'
                        : canSend
                          ? 'bg-[color:var(--accent-orange)] text-white hover:bg-[color:var(--accent-orange)]/90'
                          : 'bg-muted text-muted-foreground/40',
                    )}
                  >
                    {isStreaming ? (
                      <Square className="size-3.5" fill="currentColor" />
                    ) : (
                      <ArrowUp className="size-4" />
                    )}
                  </button>
                </div>
              </div>
            </div>
          </div>
          <div className="hidden flex-wrap items-center gap-1.5">
            <AgentPicker
              value={agentKind}
              onChange={setAgent}
              disabled={isStreaming}
            />
            <ComposerWorkspacePicker
              value={workspacePath}
              onChange={setWorkspace}
              disabled={isStreaming}
              fallbackLabel="Default workspace"
            />
          </div>
        </div>
      </div>
    )
  }),
)

interface SkillItem {
  name: string
  description: string
}

function orderedSkills(
  builtInSkills: SkillItem[],
  userSkills: SkillItem[],
  externalSkills: SkillItem[],
  employeeSkillNames: string[],
  filter: string,
): SkillItem[] {
  const lc = filter.toLowerCase()
  const matches = (s: SkillItem) =>
    !lc ||
    s.name.toLowerCase().includes(lc) ||
    s.description.toLowerCase().includes(lc)
  const employeeSet = new Set(employeeSkillNames)
  return [
    ...builtInSkills.filter((s) => employeeSet.has(s.name)).filter(matches),
    ...userSkills.filter(matches),
    ...builtInSkills.filter((s) => !employeeSet.has(s.name)).filter(matches),
    ...externalSkills.filter(matches),
  ]
}

interface PickerKeyHandlerArgs<T> {
  index: number
  setIndex: (next: number) => void
  onSelect: (item: T) => void
  clearToken: () => void
}

function handleSkillKey(
  e: KeyboardEvent<HTMLTextAreaElement>,
  args: PickerKeyHandlerArgs<string> & { flat: SkillItem[] },
): void {
  if (e.key === 'Enter' || e.key === 'Tab') {
    e.preventDefault()
    const skill = args.flat[args.index]
    if (skill) args.onSelect(skill.name)
    else args.clearToken()
    return
  }
  applyArrows(e, args.index, args.setIndex, args.flat.length)
  if (e.key === 'Escape') {
    e.preventDefault()
    args.clearToken()
  }
}

interface TabItem {
  pageId: number
  tabId: number
  url: string
  title: string
  isActive: boolean
}

function handleTabKey(
  e: KeyboardEvent<HTMLTextAreaElement>,
  args: PickerKeyHandlerArgs<BrowserTabAttachment> & { tabs: TabItem[] },
): void {
  if (e.key === 'Enter' || e.key === 'Tab') {
    e.preventDefault()
    const tab = args.tabs[args.index]
    if (tab) {
      args.onSelect({
        kind: 'browserTab',
        pageId: tab.pageId,
        tabId: tab.tabId,
        url: tab.url,
        title: tab.title,
      })
    } else {
      args.clearToken()
    }
    return
  }
  applyArrows(e, args.index, args.setIndex, args.tabs.length)
  if (e.key === 'Escape') {
    e.preventDefault()
    args.clearToken()
  }
}

function applyArrows(
  e: KeyboardEvent<HTMLTextAreaElement>,
  index: number,
  setIndex: (next: number) => void,
  count: number,
): void {
  if (e.key === 'ArrowDown') {
    e.preventDefault()
    setIndex(Math.min(index + 1, Math.max(0, count - 1)))
    return
  }
  if (e.key === 'ArrowUp') {
    e.preventDefault()
    setIndex(Math.max(index - 1, 0))
  }
}
