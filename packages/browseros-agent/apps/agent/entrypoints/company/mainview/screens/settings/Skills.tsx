import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@company/components/ui/alert-dialog'
import { Button } from '@company/components/ui/button'
import { Checkbox } from '@company/components/ui/checkbox'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@company/components/ui/dialog'
import { Input } from '@company/components/ui/input'
import { Switch } from '@company/components/ui/switch'
import { cn } from '@company/lib/utils'
import { toastError } from '@company/modules/api/errorToast'
import {
  type PreviewedSkill,
  type SkillRow,
  useInstallSkill,
  usePreviewSkillSource,
  useSetSkillDisabled,
  useSkills,
  useUninstallSkill,
} from '@company/modules/api/skills.hooks'
import { Plus, Trash2 } from 'lucide-react'
import { type FC, useEffect, useState } from 'react'

// Settings → Skills page. Lists user-installed skills only — built-ins
// are filtered out server-side (see snapshot()). Install = add to all
// three agents. Disable = remove agent symlinks, keep workspace bundle.
// Uninstall = scrub everything.
export const Skills: FC = () => {
  const { data, isLoading } = useSkills()
  const [installOpen, setInstallOpen] = useState(false)

  const rows: SkillRow[] = data?.skills ?? []

  return (
    <div className="w-full max-w-3xl px-6 py-6">
      <section className="rounded-lg border border-border/70 bg-card/40">
        <div className="flex items-start justify-between gap-3 border-border/60 border-b px-4 py-3">
          <div className="min-w-0">
            <h2 className="font-medium text-[15px]">Skills</h2>
            <p className="mt-1 text-muted-foreground text-sm">
              Installed skills are available to every agent on every new
              conversation. Disabling removes the skill from each agent's
              working set; uninstalling deletes it from your machine entirely.
            </p>
          </div>
          <Button type="button" size="sm" onClick={() => setInstallOpen(true)}>
            <Plus className="size-3.5" />
            Install
          </Button>
        </div>
        <SkillList rows={rows} isLoading={isLoading} />
      </section>

      <InstallDialog open={installOpen} onOpenChange={setInstallOpen} />
    </div>
  )
}

const SkillList: FC<{ rows: SkillRow[]; isLoading: boolean }> = ({
  rows,
  isLoading,
}) => {
  if (isLoading) {
    return (
      <div className="px-4 py-6 text-muted-foreground text-sm">
        Loading skills…
      </div>
    )
  }
  if (rows.length === 0) {
    return (
      <div className="px-4 py-8 text-center text-muted-foreground text-sm">
        No skills installed. Click <strong>Install</strong> to add one from a
        GitHub repo or local folder.
      </div>
    )
  }
  return (
    <ul className="divide-y divide-border/60">
      {rows.map((row) => (
        <SkillListRow key={row.name} row={row} />
      ))}
    </ul>
  )
}

const SkillListRow: FC<{ row: SkillRow }> = ({ row }) => {
  const toggle = useSetSkillDisabled()
  const uninstall = useUninstallSkill()
  const [confirmOpen, setConfirmOpen] = useState(false)
  const busy = toggle.isPending || uninstall.isPending
  const toggleable = !busy && !row.broken

  const onToggle = async (next: boolean) => {
    try {
      await toggle.mutateAsync({ name: row.name, disabled: !next })
    } catch (err) {
      toastError(err, `Could not ${next ? 'enable' : 'disable'} skill`)
    }
  }

  const onRowClick = () => {
    if (!toggleable) return
    void onToggle(row.disabled)
  }

  const onUninstall = async () => {
    try {
      await uninstall.mutateAsync({ name: row.name })
      setConfirmOpen(false)
    } catch (err) {
      toastError(err, 'Could not uninstall skill')
    }
  }

  return (
    <li className="flex items-start gap-3 px-4 py-3">
      <button
        type="button"
        onClick={onRowClick}
        disabled={!toggleable}
        aria-label={`${row.disabled ? 'Enable' : 'Disable'} ${row.name}`}
        aria-pressed={!row.disabled}
        className={cn(
          'flex min-w-0 flex-1 cursor-pointer flex-col items-start gap-1 rounded-md text-left transition-colors',
          'hover:bg-accent/40 focus-visible:bg-accent/40 focus-visible:outline-none',
          '-mx-1 -my-0.5 px-1 py-0.5',
          !toggleable && 'cursor-default hover:bg-transparent',
        )}
      >
        <div className="flex items-baseline gap-2">
          <span
            className={cn(
              'font-medium text-[14px]',
              row.disabled && 'text-muted-foreground',
            )}
          >
            {row.name}
          </span>
          {row.broken ? (
            <span className="rounded bg-destructive/10 px-1.5 py-0.5 font-medium text-[10.5px] text-destructive uppercase tracking-wide">
              Broken
            </span>
          ) : null}
        </div>
        {row.description ? (
          <p className="line-clamp-2 text-muted-foreground text-sm">
            {row.description}
          </p>
        ) : null}
        {row.installSource ? (
          <p className="truncate font-mono text-[11.5px] text-muted-foreground/80">
            {row.installSource}
          </p>
        ) : null}
      </button>
      <div className="flex shrink-0 items-center gap-2 pt-1">
        <Switch
          checked={!row.disabled}
          onCheckedChange={onToggle}
          disabled={!toggleable}
          aria-label={row.disabled ? 'Enable skill' : 'Disable skill'}
        />
        <AlertDialog open={confirmOpen} onOpenChange={setConfirmOpen}>
          <Button
            type="button"
            variant="ghost"
            size="icon"
            onClick={() => setConfirmOpen(true)}
            disabled={busy}
            aria-label="Uninstall skill"
            title="Uninstall"
          >
            <Trash2 className="size-3.5" />
          </Button>
          <AlertDialogContent>
            <AlertDialogHeader>
              <AlertDialogTitle>Uninstall {row.name}?</AlertDialogTitle>
              <AlertDialogDescription>
                This removes the skill from every agent and deletes the local
                bundle. You can re-install it later from the same source.
              </AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter>
              <AlertDialogCancel disabled={uninstall.isPending}>
                Cancel
              </AlertDialogCancel>
              <AlertDialogAction
                onClick={onUninstall}
                disabled={uninstall.isPending}
                className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
              >
                {uninstall.isPending ? 'Uninstalling…' : 'Uninstall'}
              </AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>
      </div>
    </li>
  )
}

const InstallDialog: FC<{
  open: boolean
  onOpenChange: (open: boolean) => void
}> = ({ open, onOpenChange }) => {
  const preview = usePreviewSkillSource()
  const install = useInstallSkill()
  const [source, setSource] = useState('')
  const [staged, setStaged] = useState<PreviewedSkill[]>([])
  const [selected, setSelected] = useState<Set<string>>(() => new Set())

  // Base UI Dialog only fires onOpenChange for user-initiated closes;
  // reset whenever the controlled prop transitions to closed so a
  // successful install reopens the dialog cleanly next time.
  // biome-ignore lint/correctness/useExhaustiveDependencies: only fire on open-state transitions; preview.reset / install.reset are stable mutation handles
  useEffect(() => {
    if (!open) {
      setSource('')
      setStaged([])
      setSelected(new Set())
      preview.reset()
      install.reset()
    }
  }, [open])

  const trimmed = source.trim()
  const onPreview = async () => {
    if (!trimmed) return
    try {
      const res = await preview.mutateAsync({ source: trimmed })
      setStaged(res.skills)
      setSelected(new Set())
    } catch (err) {
      toastError(err, 'Could not load skills from that source')
    }
  }

  const onInstall = async () => {
    if (selected.size === 0) return
    try {
      await install.mutateAsync({
        source: trimmed,
        names: [...selected],
      })
      onOpenChange(false)
    } catch (err) {
      toastError(err, 'Could not install selected skills')
    }
  }

  const toggleOne = (name: string, checked: boolean) => {
    setSelected((prev) => {
      const next = new Set(prev)
      if (checked) next.add(name)
      else next.delete(name)
      return next
    })
  }

  const allSelected = staged.length > 0 && selected.size === staged.length
  const someSelected = selected.size > 0 && !allSelected
  const toggleAll = (checked: boolean) => {
    setSelected(checked ? new Set(staged.map((s) => s.name)) : new Set())
  }

  const backToSource = () => {
    setStaged([])
    setSelected(new Set())
  }

  const showSelect = staged.length > 0

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Install a skill</DialogTitle>
          <DialogDescription>
            {showSelect
              ? 'Pick which skills to install from this source.'
              : 'Paste a GitHub repo (owner/repo or full URL), a git URL, or an absolute path to a local skill folder.'}
          </DialogDescription>
        </DialogHeader>

        {showSelect ? (
          <div className="space-y-3">
            <label
              htmlFor="skill-pick-all"
              className="flex items-center gap-2 border-border/60 border-b pb-2 text-sm"
            >
              <Checkbox
                id="skill-pick-all"
                checked={allSelected}
                indeterminate={someSelected}
                onCheckedChange={(c) => toggleAll(Boolean(c))}
              />
              <span className="font-medium">
                Select all ({staged.length}{' '}
                {staged.length === 1 ? 'skill' : 'skills'})
              </span>
            </label>
            <ul className="max-h-72 space-y-2 overflow-y-auto">
              {staged.map((s) => {
                const id = `skill-pick-${s.name}`
                return (
                  <li key={s.name}>
                    <label
                      htmlFor={id}
                      className="flex items-start gap-3 rounded-md p-2 text-sm hover:bg-accent/40"
                    >
                      <Checkbox
                        id={id}
                        className="mt-0.5"
                        checked={selected.has(s.name)}
                        onCheckedChange={(c) => toggleOne(s.name, Boolean(c))}
                      />
                      <span className="min-w-0 flex-1">
                        <span className="block font-mono text-xs">
                          {s.name}
                        </span>
                        <span className="mt-0.5 block text-muted-foreground text-xs">
                          {s.description || '—'}
                        </span>
                      </span>
                    </label>
                  </li>
                )
              })}
            </ul>
          </div>
        ) : (
          <Input
            autoFocus
            value={source}
            onChange={(e) => setSource(e.target.value)}
            placeholder="anthropics/skills"
            disabled={preview.isPending}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && trimmed && !preview.isPending) {
                void onPreview()
              }
            }}
          />
        )}

        <DialogFooter>
          <Button
            type="button"
            variant="ghost"
            onClick={() => onOpenChange(false)}
            disabled={preview.isPending || install.isPending}
          >
            Cancel
          </Button>
          {showSelect ? (
            <>
              <Button
                type="button"
                variant="ghost"
                onClick={backToSource}
                disabled={install.isPending}
              >
                Back
              </Button>
              <Button
                type="button"
                onClick={onInstall}
                disabled={selected.size === 0 || install.isPending}
              >
                {install.isPending
                  ? 'Installing…'
                  : `Install ${selected.size || ''}`.trim()}
              </Button>
            </>
          ) : (
            <Button
              type="button"
              onClick={onPreview}
              disabled={!trimmed || preview.isPending}
            >
              {preview.isPending ? 'Loading…' : 'Next'}
            </Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
