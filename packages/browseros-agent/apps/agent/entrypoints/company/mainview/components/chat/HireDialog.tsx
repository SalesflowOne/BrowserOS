// biome-ignore-all lint/nursery/noExcessiveLinesPerFile: hire wizard is one coherent UI flow; splitting hurts navigation more than the line count helps

import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@company/components/ui/dialog'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@company/components/ui/select'
import { type Tint, tintTokens } from '@company/lib/tints'
import { cn } from '@company/lib/utils'
import {
  type AgentDetection,
  useAvailableAgents,
} from '@company/modules/api/agents.hooks'
import { useHireEmployee } from '@company/modules/api/employees.hooks'
import { toastError } from '@company/modules/api/errorToast'
import {
  type HireTemplate,
  useHireTemplates,
} from '@company/modules/api/templates.hooks'
import { ArrowLeft, Check, ExternalLink } from 'lucide-react'
import { type FC, useEffect, useState } from 'react'
import { Avatar } from './Avatar'
import { WorkspacePicker } from './WorkspacePicker'

const BLANK_TEMPLATE_ID = 'blank'

function copyForStep(step: 0 | 1): { title: string; description: string } {
  if (step === 0) {
    return {
      title: 'Hire someone',
      description:
        'Pick a role to start from. You can name them and tweak their personality next.',
    }
  }
  return {
    title: 'Tell me about them',
    description:
      'The role is locked to the template you picked. Give them a name and a personality.',
  }
}

const TINT_CHOICES: Tint[] = [
  'orange',
  'blue',
  'green',
  'purple',
  'pink',
  'teal',
]

interface Draft {
  templateId: string
  /** Locked to template.roleTitle for named templates; user-typed
   *  for the Custom template. */
  roleTitle: string
  /** Locked to template.instructions for named templates;
   *  user-typed for the Custom template. */
  roleInstructions: string
  name: string
  tagline: string
  monogram: string
  tint: Tint
  bio: string
  agentKind: string
  /** Directory the agent will operate in. `null` means "use the
   *  server-generated sandbox dir under ~/.browserclaw/workspaces/".
   *  The user can also pick a real project directory; either way
   *  the path is locked once the hire commits. */
  workspacePath: string | null
}

interface Props {
  open: boolean
  onOpenChange: (open: boolean) => void
}

function isSelectable(detection: AgentDetection): boolean {
  return (
    detection.installState === 'installed' ||
    detection.installState === 'npx-available'
  )
}

function pickDefaultAgent(agents: AgentDetection[]): string {
  const selectable = agents.filter(isSelectable)
  if (selectable.length === 0) return ''
  const claude = selectable.find((a) => a.agentId === 'claude')
  return (claude ?? selectable[0])?.agentId ?? ''
}

export const HireDialog: FC<Props> = ({ open, onOpenChange }) => {
  const hire = useHireEmployee()
  const templates = useHireTemplates()
  const agents = useAvailableAgents()
  const [step, setStep] = useState<0 | 1>(0)
  const [draft, setDraft] = useState<Draft | null>(null)

  useEffect(() => {
    if (!open) {
      setStep(0)
      setDraft(null)
    }
  }, [open])

  const pickTemplate = (t: HireTemplate) => {
    setDraft({
      templateId: t.id,
      roleTitle: t.roleTitle,
      roleInstructions: t.instructions,
      name: t.defaultName,
      tagline: t.defaultTagline,
      monogram: t.monogram,
      tint: t.tint as Tint,
      bio: t.defaultBio,
      agentKind: pickDefaultAgent(agents.data ?? []),
      // null = server picks the sandbox default at submit time.
      workspacePath: null,
    })
    setStep(1)
  }

  const submit = async () => {
    if (!draft) return
    const isCustom = draft.templateId === BLANK_TEMPLATE_ID
    try {
      await hire.mutateAsync({
        templateId: draft.templateId,
        name: draft.name,
        tagline: draft.tagline || undefined,
        monogram: draft.monogram,
        tint: draft.tint,
        bio: draft.bio || undefined,
        agentKind: draft.agentKind,
        // Omitting `workspacePath` lets the server generate a fresh
        // sandbox under ~/.browserclaw/workspaces/<id>.
        workspacePath: draft.workspacePath ?? undefined,
        // Server requires both fields when templateId === 'blank' and
        // ignores them otherwise.
        ...(isCustom
          ? {
              customRoleTitle: draft.roleTitle,
              customInstructions: draft.roleInstructions,
            }
          : {}),
      })
      onOpenChange(false)
    } catch (err) {
      toastError(err, 'Hire failed')
    }
  }

  const { title, description } = copyForStep(step)

  const agentsList = agents.data ?? []
  const hasSelectableAgent = agentsList.some(isSelectable)
  const isCustom = draft?.templateId === BLANK_TEMPLATE_ID
  const draftIsValid =
    !!draft &&
    Boolean(draft.name.trim()) &&
    Boolean(draft.roleTitle.trim()) &&
    (!isCustom || Boolean(draft.roleInstructions.trim())) &&
    Boolean(draft.agentKind) &&
    hasSelectableAgent

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[calc(100vh-2rem)] grid-rows-[auto_minmax(0,1fr)_auto] sm:max-w-[680px]">
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
          <DialogDescription>{description}</DialogDescription>
        </DialogHeader>

        <div className="-mx-2 min-h-0 overflow-y-auto px-2">
          {step === 0 ? (
            <TemplateGrid
              templates={templates.data ?? []}
              onPick={pickTemplate}
            />
          ) : draft ? (
            <ProfileForm
              draft={draft}
              setDraft={setDraft}
              agents={agentsList}
            />
          ) : null}
        </div>

        {step === 1 && draft ? (
          <ActionBar
            onBack={() => setStep(0)}
            onSubmit={submit}
            isPending={hire.isPending}
            canNext={draftIsValid}
            name={draft.name}
          />
        ) : null}
      </DialogContent>
    </Dialog>
  )
}

const TemplateGrid: FC<{
  templates: HireTemplate[]
  onPick: (t: HireTemplate) => void
}> = ({ templates, onPick }) => (
  <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
    {templates.map((t) => (
      <button
        type="button"
        key={t.id}
        onClick={() => onPick(t)}
        className="group flex items-start gap-3 rounded-xl border border-border/60 bg-card p-3 text-left transition-colors hover:border-[color:var(--accent-orange)]/30 hover:bg-[color:var(--accent-orange)]/[0.04]"
      >
        <Avatar monogram={t.monogram} tint={t.tint as Tint} size="md" />
        <div className="min-w-0 flex-1">
          <p className="font-medium text-[13.5px] text-foreground">
            {t.roleTitle}
          </p>
          <p className="mt-0.5 text-[11.5px] text-muted-foreground leading-snug">
            {t.roleSummary}
          </p>
        </div>
      </button>
    ))}
  </div>
)

const INSTALL_HINTS: { label: string; url: string }[] = [
  {
    label: 'Install Claude Code',
    url: 'https://github.com/anthropics/claude-code#get-started',
  },
  {
    label: 'Install Codex CLI',
    url: 'https://developers.openai.com/codex/cli#cli-setup',
  },
]

const ProfileForm: FC<{
  draft: Draft
  setDraft: (d: Draft) => void
  agents: AgentDetection[]
}> = ({ draft, setDraft, agents }) => {
  const update = <K extends keyof Draft>(k: K, v: Draft[K]) =>
    setDraft({ ...draft, [k]: v })

  const selectableAgents = agents.filter(isSelectable)
  const hasSelectable = selectableAgents.length > 0
  const isCustom = draft.templateId === BLANK_TEMPLATE_ID

  return (
    <div className="flex flex-col gap-4">
      <Field label="Powered by">
        {hasSelectable ? (
          <Select
            value={draft.agentKind}
            onValueChange={(value) => update('agentKind', value ?? '')}
          >
            <SelectTrigger className="w-full">
              <SelectValue placeholder="Pick an agent">
                {(value) =>
                  selectableAgents.find((a) => a.agentId === value)
                    ?.displayName ?? value
                }
              </SelectValue>
            </SelectTrigger>
            <SelectContent>
              {selectableAgents.map((a) => (
                <SelectItem key={a.agentId} value={a.agentId}>
                  <div className="flex w-full items-center gap-2">
                    <span className="flex-1 truncate">{a.displayName}</span>
                    <AgentStateChip detection={a} />
                  </div>
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        ) : (
          <NoAgentsBanner />
        )}
      </Field>
      <Field label="Workspace">
        <WorkspacePicker
          value={draft.workspacePath}
          onChange={(path) => update('workspacePath', path)}
        />
      </Field>
      <div className="flex items-center gap-4">
        <Avatar monogram={draft.monogram || 'X'} tint={draft.tint} size="lg" />
        <div className="flex flex-1 flex-col gap-2">
          <Field label="Name">
            <input
              // biome-ignore lint/a11y/noAutofocus: dialog flow expects keyboard to land on first input
              autoFocus
              value={draft.name}
              onChange={(e) => update('name', e.target.value)}
              placeholder="e.g. Alex, Maya, Sam"
              className="w-full rounded-md border border-border/60 bg-card px-3 py-1.5 text-[13.5px] text-foreground outline-none transition-colors focus:border-[color:var(--accent-orange)]/40"
            />
          </Field>
          <Field label="Role">
            {isCustom ? (
              <input
                value={draft.roleTitle}
                onChange={(e) => update('roleTitle', e.target.value)}
                placeholder="e.g. Marketing Analyst"
                className="w-full rounded-md border border-border/60 bg-card px-3 py-1.5 text-[13.5px] text-foreground outline-none transition-colors focus:border-[color:var(--accent-orange)]/40"
              />
            ) : (
              <div className="rounded-md border border-border/40 border-dashed bg-muted/30 px-3 py-1.5 text-[13.5px] text-muted-foreground">
                {draft.roleTitle}
              </div>
            )}
          </Field>
        </div>
      </div>

      <Field label="Tagline">
        <input
          value={draft.tagline}
          onChange={(e) => update('tagline', e.target.value)}
          placeholder="One line that shows up under their name"
          className="w-full rounded-md border border-border/60 bg-card px-3 py-1.5 text-[13.5px] text-foreground outline-none transition-colors focus:border-[color:var(--accent-orange)]/40"
        />
      </Field>

      <Field label="What should they focus on">
        <textarea
          value={draft.bio}
          onChange={(e) => update('bio', e.target.value)}
          rows={3}
          placeholder="The job description — what they handle, what they're good at, how they should work."
          className="w-full resize-none rounded-md border border-border/60 bg-card px-3 py-2 text-[13px] text-foreground outline-none transition-colors focus:border-[color:var(--accent-orange)]/40"
        />
      </Field>

      {isCustom ? (
        <Field label="How should they work">
          <textarea
            value={draft.roleInstructions}
            onChange={(e) => update('roleInstructions', e.target.value)}
            rows={6}
            placeholder={
              'Define the playbook. Bullet points work best — e.g.\n- Analyse our top-of-funnel weekly\n- Write a Monday brief\n- Cite every claim'
            }
            className="w-full resize-none rounded-md border border-border/60 bg-card px-3 py-2 text-[13px] text-foreground outline-none transition-colors focus:border-[color:var(--accent-orange)]/40"
          />
        </Field>
      ) : (
        <Field label="What this role does">
          <pre className="max-h-48 w-full overflow-y-auto whitespace-pre-wrap rounded-md border border-border/40 border-dashed bg-muted/30 px-3 py-2 font-sans text-[12.5px] text-muted-foreground leading-relaxed">
            {draft.roleInstructions}
          </pre>
        </Field>
      )}

      <div className="flex items-center gap-3">
        <Field label="Monogram" className="w-24">
          <input
            value={draft.monogram}
            onChange={(e) =>
              update('monogram', e.target.value.slice(0, 2).toUpperCase())
            }
            maxLength={2}
            className="w-full rounded-md border border-border/60 bg-card px-3 py-1.5 text-center font-mono text-[13.5px] text-foreground uppercase outline-none transition-colors focus:border-[color:var(--accent-orange)]/40"
          />
        </Field>
        <Field label="Color">
          <div className="flex items-center gap-1.5">
            {TINT_CHOICES.map((c) => {
              const tk = tintTokens(c)
              const active = draft.tint === c
              return (
                <button
                  type="button"
                  key={c}
                  onClick={() => update('tint', c)}
                  aria-label={c}
                  style={{ backgroundColor: tk.bg }}
                  className={cn(
                    'inline-flex size-6 items-center justify-center rounded-full ring-2 ring-card ring-offset-2 transition-all',
                    active ? 'ring-foreground/60' : 'ring-transparent',
                  )}
                >
                  {active ? (
                    <Check
                      className="size-3"
                      style={{ color: tk.fg }}
                      aria-hidden="true"
                    />
                  ) : null}
                </button>
              )
            })}
          </div>
        </Field>
      </div>
    </div>
  )
}

const AgentStateChip: FC<{ detection: AgentDetection }> = ({ detection }) => {
  if (detection.installState === 'installed') {
    return (
      <span className="rounded-md bg-muted px-1.5 py-0.5 font-mono text-[10px] text-muted-foreground">
        {detection.version ?? 'installed'}
      </span>
    )
  }
  return (
    <span className="rounded-md bg-muted px-1.5 py-0.5 text-[10px] text-muted-foreground">
      via npx
    </span>
  )
}

const NoAgentsBanner: FC = () => (
  <div className="flex flex-col gap-2 rounded-lg border border-border/60 border-dashed bg-card/60 p-3 text-[12.5px]">
    <p className="text-foreground/80">
      No ACP agents detected on this machine. Install one and reopen the dialog
      to hire.
    </p>
    <div className="flex flex-wrap gap-2">
      {INSTALL_HINTS.map((hint) => (
        <a
          key={hint.url}
          href={hint.url}
          target="_blank"
          rel="noopener noreferrer"
          className="inline-flex items-center gap-1.5 rounded-md border border-border/60 bg-background px-2 py-1 text-[11.5px] text-foreground transition-colors hover:border-[color:var(--accent-orange)]/40"
        >
          {hint.label}
          <ExternalLink className="size-3" />
        </a>
      ))}
    </div>
  </div>
)

const ActionBar: FC<{
  onBack: () => void
  onSubmit: () => void
  isPending: boolean
  canNext: boolean
  name: string
}> = ({ onBack, onSubmit, isPending, canNext, name }) => (
  <div className="mt-2 flex items-center justify-between gap-2 border-border/50 border-t pt-3">
    <button
      type="button"
      onClick={onBack}
      className="inline-flex items-center gap-1.5 rounded-md px-3 py-1.5 text-[13px] text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
    >
      <ArrowLeft className="size-3.5" />
      Back
    </button>
    <button
      type="button"
      onClick={onSubmit}
      disabled={isPending || !canNext}
      className={cn(
        'inline-flex items-center gap-1.5 rounded-md px-3.5 py-1.5 font-medium text-[13px] transition-colors disabled:opacity-60',
        canNext
          ? 'bg-[color:var(--accent-orange)] text-white hover:bg-[color:var(--accent-orange)]/90'
          : 'bg-muted text-muted-foreground/50',
      )}
    >
      <Check className="size-3.5" />
      {isPending ? 'Hiring…' : `Hire ${name.trim() || 'them'}`}
    </button>
  </div>
)

const Field: FC<{
  label: string
  children: React.ReactNode
  className?: string
}> = ({ label, children, className }) => (
  <div className={cn('flex flex-col gap-1', className)}>
    <span className="text-[10.5px] text-muted-foreground/80 uppercase tracking-[0.14em]">
      {label}
    </span>
    {children}
  </div>
)
