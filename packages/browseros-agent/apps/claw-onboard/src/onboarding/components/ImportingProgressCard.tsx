import { RefreshCw } from 'lucide-react'

interface ImportingProgressCardProps {
  progress: number
  total: number
  logins: number
}

/** Displays local import progress while selected profile sessions are copied. */
export function ImportingProgressCard({
  progress,
  total,
  logins,
}: ImportingProgressCardProps) {
  const percent = total === 0 ? 0 : Math.min(100, (progress / total) * 100)
  return (
    <div className="rounded-xl border border-border-2 bg-card p-5">
      <div className="mb-3.5 flex items-center gap-2.5">
        <RefreshCw className="size-[18px] animate-spin text-accent" />
        <span className="font-bold text-[14px]">Importing sessions...</span>
      </div>
      <div className="mb-2.5 h-2 overflow-hidden rounded-full bg-bg-sunken">
        <div
          className="h-full bg-accent transition-[width] duration-100"
          style={{ width: `${percent}%` }}
        />
      </div>
      <div className="font-mono text-[12.5px] text-ink-2">
        {progress} / {total} sites . {logins} passwords
      </div>
    </div>
  )
}
