import { Label } from '@company/components/ui/label'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@company/components/ui/select'
import { Switch } from '@company/components/ui/switch'
import { toastError } from '@company/modules/api/errorToast'
import {
  useSystemSettings,
  useUpdateSystemSettings,
} from '@company/modules/api/system.hooks'
import { DEFAULT_AUTOSTART_SETTINGS } from '../../../shared/autostart'
import { DEFAULT_NOTIFICATION_SETTINGS } from '../../../shared/notifications'
import {
  DEFAULT_PERMISSION_MODE,
  PERMISSION_MODES,
  type PermissionMode,
} from '../../../shared/permission'
import { BrowserosSection } from './BrowserosSection'

export function General() {
  // Each subsection calls useSystemSettings + useUpdateSystemSettings
  // itself; react-query-kit caches by key so there's a single network
  // fetch shared across them. Composing this way keeps each section's
  // cognitive complexity well under the lint cap and isolates the
  // handler / state it owns.
  return (
    <div className="w-full max-w-3xl space-y-6 px-6 py-6">
      <BrowserosSection />
      <ApplicationSection />
      <NotificationsSection />
      <ConversationDefaultsSection />
    </div>
  )
}

function ConversationDefaultsSection() {
  const settings = useSystemSettings()
  const update = useUpdateSystemSettings()
  const defaultPermissionMode =
    settings.data?.defaultPermissionMode ?? DEFAULT_PERMISSION_MODE
  const onChange = async (value: PermissionMode | null) => {
    if (!value) return
    try {
      await update.mutateAsync({ defaultPermissionMode: value })
    } catch (err) {
      toastError(err, 'Could not save default permission mode')
    }
  }
  return (
    // Conversation defaults lives outside the BrowserOS form because it
    // saves eagerly per-change rather than waiting for a submit; mixing
    // eager and submit semantics inside one <form> would lead to "did my
    // change save?" ambiguity.
    <section className="rounded-lg border border-border/70 bg-card/40">
      <div className="border-border/60 border-b px-4 py-3">
        <h2 className="font-medium text-[15px]">Conversation defaults</h2>
        <p className="mt-1 text-muted-foreground text-sm">
          Applied when a new thread is created. Existing threads keep the mode
          they were started with.
        </p>
      </div>
      <div className="space-y-2 p-4">
        <Label htmlFor="default-permission-mode">
          Default permission for new threads
        </Label>
        <Select
          value={defaultPermissionMode}
          onValueChange={onChange}
          disabled={settings.isLoading || update.isPending}
        >
          <SelectTrigger id="default-permission-mode" className="w-full">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {PERMISSION_MODES.map((mode) => (
              <SelectItem key={mode} value={mode}>
                <div className="flex flex-col">
                  <span>{PERMISSION_LABELS[mode]}</span>
                  <span className="text-[10px] text-muted-foreground">
                    {PERMISSION_DESCRIPTIONS[mode]}
                  </span>
                </div>
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>
    </section>
  )
}

const PERMISSION_LABELS: Record<PermissionMode, string> = {
  'auto-approve-reads': 'Auto-approve reads',
  manual: 'Approve each request',
  'read-only': 'Read-only',
  'allow-all': 'Allow everything',
}

const PERMISSION_DESCRIPTIONS: Record<PermissionMode, string> = {
  'auto-approve-reads': 'Reads pass; writes & shell prompt you',
  manual: 'Every gate prompts you',
  'read-only': 'Reads pass; writes & shell auto-denied',
  'allow-all': 'Agent runs unattended — use with care',
}

const ApplicationSection = () => {
  const settings = useSystemSettings()
  const update = useUpdateSystemSettings()
  const autostart = settings.data?.autostart ?? DEFAULT_AUTOSTART_SETTINGS
  const disabled = settings.isLoading || update.isPending
  const onChange = async (value: boolean) => {
    try {
      await update.mutateAsync({ autostart: { launchAtLogin: value } })
    } catch (err) {
      toastError(err, 'Could not save application settings')
    }
  }
  return (
    <section className="rounded-lg border border-border/70 bg-card/40">
      <div className="border-border/60 border-b px-4 py-3">
        <h2 className="font-medium text-[15px]">Application</h2>
        <p className="mt-1 text-muted-foreground text-sm">
          How BrowserClaw behaves on this machine. Closing the window hides it
          to the menubar so agents keep running in the background.
        </p>
      </div>
      <div className="divide-y divide-border/60">
        <NotificationToggle
          id="launch-at-login"
          label="Launch at login (minimised)"
          description="Starts BrowserClaw automatically when you log in. The window stays hidden; the menubar icon is your way back in."
          checked={autostart.launchAtLogin}
          disabled={disabled}
          onChange={onChange}
        />
      </div>
    </section>
  )
}

const NotificationsSection = () => {
  const settings = useSystemSettings()
  const update = useUpdateSystemSettings()
  const notifications =
    settings.data?.notifications ?? DEFAULT_NOTIFICATION_SETTINGS
  const disabled = settings.isLoading || update.isPending
  const onChange = async (field: 'agentActivity' | 'sound', value: boolean) => {
    try {
      await update.mutateAsync({ notifications: { [field]: value } })
    } catch (err) {
      toastError(err, 'Could not save notification settings')
    }
  }
  return (
    <section className="rounded-lg border border-border/70 bg-card/40">
      <div className="border-border/60 border-b px-4 py-3">
        <h2 className="font-medium text-[15px]">Notifications</h2>
        <p className="mt-1 text-muted-foreground text-sm">
          System notifications fire when an agent needs your attention on a
          thread that isn't currently focused. Telegram-linked threads are
          always skipped.
        </p>
      </div>
      <div className="divide-y divide-border/60">
        <NotificationToggle
          id="notify-agent-activity"
          label="Notify on agent activity"
          description="Shows a notification when an agent replies, needs an allow/deny decision, asks to connect a service, or hits an error in a thread that is not currently focused."
          checked={notifications.agentActivity}
          disabled={disabled}
          onChange={(v) => onChange('agentActivity', v)}
        />
        <NotificationToggle
          id="notify-sound"
          label="Notification sound"
          description="Plays the default notification sound on each toast. Turn off for silent notifications."
          checked={notifications.sound}
          disabled={disabled}
          onChange={(v) => onChange('sound', v)}
        />
      </div>
    </section>
  )
}

const NotificationToggle = ({
  id,
  label,
  description,
  checked,
  disabled,
  onChange,
}: {
  id: string
  label: string
  description: string
  checked: boolean
  disabled: boolean
  onChange: (value: boolean) => void
}) => {
  // Whole-row click-to-toggle via shadcn's Label + Switch htmlFor
  // association — clicking anywhere on the Label fires the Switch's
  // native input event, which routes through onCheckedChange. No extra
  // keyboard / role handling needed since the Switch handles its own
  // focus + Space/Enter semantics.
  return (
    <Label
      htmlFor={id}
      className={`flex cursor-pointer items-start justify-between gap-4 px-4 py-3 hover:bg-accent/30 ${disabled ? 'cursor-not-allowed opacity-60' : ''}`}
    >
      <div className="min-w-0 flex-1">
        <p className="font-medium text-sm">{label}</p>
        <p className="mt-1 font-normal text-muted-foreground text-xs leading-relaxed">
          {description}
        </p>
      </div>
      <Switch
        id={id}
        checked={checked}
        onCheckedChange={onChange}
        disabled={disabled}
        className="mt-1 shrink-0"
      />
    </Label>
  )
}
