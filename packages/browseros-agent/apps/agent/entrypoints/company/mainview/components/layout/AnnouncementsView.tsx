import { Avatar } from '@company/components/chat/Avatar'
import { HireDialog } from '@company/components/chat/HireDialog'
import { MarkdownView } from '@company/components/chat/MarkdownView'
import { formatRelativeLong } from '@company/lib/dateTime'
import type { Tint } from '@company/lib/tints'
import {
  type AnnouncementRow,
  useAnnouncements,
  useAnnouncementsStream,
} from '@company/modules/api/announcements.hooks'
import { useEmployees } from '@company/modules/api/employees.hooks'
import { Megaphone, UserPlus } from 'lucide-react'
import { type FC, useMemo, useState } from 'react'

export const AnnouncementsView: FC = () => {
  const announcements = useAnnouncements()
  const employees = useEmployees()
  const employeeById = useMemo(
    () => new Map((employees.data ?? []).map((e) => [e.id, e])),
    [employees.data],
  )
  const [hireOpen, setHireOpen] = useState(false)

  // Subscribe to the live stream while the view is mounted; new posts
  // prepend into the cache directly so the list updates without a
  // refetch round-trip.
  useAnnouncementsStream()

  // Fresh-launch state: no employees hired yet means no source of
  // announcements at all. The standard view would just be an empty
  // shell so swap it for the hire CTA.
  const noEmployees = employees.isSuccess && (employees.data ?? []).length === 0
  if (noEmployees) {
    return (
      <>
        <FirstHireCTA onHire={() => setHireOpen(true)} />
        <HireDialog open={hireOpen} onOpenChange={setHireOpen} />
      </>
    )
  }

  const rows = (announcements.data ?? [])
    .slice()
    .sort((a, b) => b.postedAt - a.postedAt)

  return (
    <div className="flex h-full min-h-0 flex-col bg-background">
      <header className="app-region-drag flex shrink-0 items-center gap-3 border-border/50 border-b px-6 py-3">
        <span className="inline-flex size-9 items-center justify-center rounded-full bg-[color:var(--accent-orange)]/10 text-[color:var(--accent-orange)]">
          <Megaphone className="size-4" />
        </span>
        <div>
          <p className="font-semibold text-[16px] leading-tight">
            Announcements
          </p>
          <p className="text-[12px] text-muted-foreground leading-snug">
            What your team has shipped
          </p>
        </div>
      </header>

      <div className="min-h-0 flex-1 overflow-y-auto">
        <div className="mx-auto flex w-full max-w-[700px] flex-col gap-4 px-6 py-8">
          {rows.length === 0 ? (
            <EmptyState />
          ) : (
            rows.map((a) => (
              <Post
                key={a.id}
                announcement={a}
                employee={employeeById.get(a.employeeId) ?? null}
              />
            ))
          )}
        </div>
      </div>
    </div>
  )
}

const Post: FC<{
  announcement: AnnouncementRow
  employee: {
    name: string
    role: string
    monogram: string
    tint: string
    status?: string
  } | null
}> = ({ announcement: a, employee }) => {
  // Posts whose author was fired (the cascade rule in the schema deletes
  // their row anyway) shouldn't render: guard for the gap between the
  // optimistic UI delete and the SSE refresh.
  if (!employee) return null
  return (
    <article className="group rounded-2xl border border-border/60 bg-card/50 p-5 transition-colors hover:border-border hover:bg-card/70">
      <header className="mb-3 flex items-center gap-3">
        <Avatar
          monogram={employee.monogram}
          tint={employee.tint as Tint}
          size="md"
        />
        <div className="min-w-0 flex-1 leading-tight">
          <p className="font-medium text-[13.5px] text-foreground">
            {employee.name}
          </p>
          <p className="text-[11.5px] text-muted-foreground/80">
            {employee.role}
          </p>
        </div>
        <span className="font-mono text-[10.5px] text-muted-foreground/60 tabular-nums">
          {formatRelativeLong(a.postedAt)}
        </span>
      </header>
      <h2 className="font-semibold text-[16px] text-foreground leading-snug tracking-tight">
        <MarkdownView mode="inline" source={a.title} />
      </h2>
      <div className="mt-2 max-w-[60ch] text-[13.5px] text-foreground/85 leading-[1.65]">
        <MarkdownView mode="block" source={a.body} />
      </div>
    </article>
  )
}

const EmptyState: FC = () => (
  <div className="flex flex-col items-center gap-2 rounded-2xl border border-border/60 border-dashed bg-card/30 px-6 py-14 text-center">
    <Megaphone className="size-5 text-muted-foreground/50" />
    <p className="text-[13.5px] text-muted-foreground">No announcements yet.</p>
    <p className="text-[12px] text-muted-foreground/70">
      Your team will post here when they ship.
    </p>
  </div>
)

const FirstHireCTA: FC<{ onHire: () => void }> = ({ onHire }) => (
  <div className="flex h-full min-h-0 flex-col items-center justify-center bg-background px-6">
    <div className="flex max-w-md flex-col items-center gap-5 text-center">
      <span className="inline-flex size-14 items-center justify-center rounded-full bg-[color:var(--accent-orange)]/10 text-[color:var(--accent-orange)]">
        <UserPlus className="size-6" />
      </span>
      <div className="flex flex-col gap-2">
        <h1 className="font-semibold text-[20px] text-foreground tracking-tight">
          Hire your first employee
        </h1>
        <p className="text-[13.5px] text-muted-foreground leading-relaxed">
          Pick a role, give them a name and a personality, and they're ready to
          work. Each employee gets their own sandboxed workspace and a locked
          instruction set tailored to their role.
        </p>
      </div>
      <button
        type="button"
        onClick={onHire}
        className="inline-flex items-center gap-2 rounded-md bg-[color:var(--accent-orange)] px-4 py-2 font-medium text-[13.5px] text-white transition-colors hover:bg-[color:var(--accent-orange)]/90"
      >
        <UserPlus className="size-4" />
        Hire your first employee
      </button>
    </div>
  </div>
)
