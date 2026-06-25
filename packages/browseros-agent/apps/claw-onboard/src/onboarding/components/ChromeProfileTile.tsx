import { User } from 'lucide-react'
import { Checkbox } from '@/components/ui/checkbox'
import { cn } from '@/lib/utils'
import type { ChromeProfile } from '../onboarding-v2.helpers'

interface ChromeProfileTileProps {
  profile: ChromeProfile
  checked: boolean
  onCheckedChange: (next: boolean) => void
}

/** Renders one selectable Chrome profile row in the import picker. */
export function ChromeProfileTile({
  profile,
  checked,
  onCheckedChange,
}: ChromeProfileTileProps) {
  return (
    // biome-ignore lint/a11y/useSemanticElements: a button with role=checkbox is the row-toggle pattern; the design demands the entire tile is the click target, not just a checkbox primitive
    <button
      type="button"
      role="checkbox"
      aria-checked={checked}
      onClick={() => onCheckedChange(!checked)}
      className={cn(
        'flex w-full items-center gap-3 rounded-xl border px-4 py-3 text-left transition-colors',
        checked
          ? 'border-accent bg-accent-tint'
          : 'border-border-2 bg-card hover:border-border-strong',
      )}
    >
      <Checkbox checked={checked} tabIndex={-1} aria-hidden />
      <span className="flex size-[30px] shrink-0 items-center justify-center rounded-lg border border-border-2 bg-card text-ink-2">
        <User className="size-[15px]" />
      </span>
      <div className="min-w-0 flex-1">
        <div className="font-bold text-[13.5px] text-ink">{profile.name}</div>
        <div className="truncate text-[11.5px] text-ink-3">{profile.email}</div>
      </div>
      <div className="shrink-0 text-right font-mono text-[11.5px] text-ink-2">
        {profile.sites} sites . {profile.logins} logins
      </div>
    </button>
  )
}
