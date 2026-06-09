import { ChevronDown, Sparkles } from 'lucide-react'
import type { FC } from 'react'

export const ChatLayoutShell: FC = () => (
  <div className="flex h-full min-h-0 flex-col bg-background font-sans text-foreground">
    <header className="flex h-[46px] shrink-0 items-center gap-2 border-[color-mix(in_oklch,var(--border)_50%,transparent)] border-b pr-12 pl-[14px] font-medium text-[13px]">
      <Sparkles className="size-4 text-[var(--accent-orange)]" aria-hidden />
      <span className="flex-1">BrowserOS Agent</span>
      <ChevronDown className="size-3.5 text-muted-foreground" aria-hidden />
    </header>

    <div className="flex min-h-0 flex-1 flex-col gap-3 overflow-y-auto px-[14px] pt-[14px] pb-5">
      <div className="max-w-[88%] self-end rounded-[14px] bg-secondary px-[14px] py-2.5 text-[14px] leading-[1.55]">
        Draft me a quick post about how AI agents are taking over the boring
        parts of running a startup.
      </div>
      <div className="max-w-[92%] self-start text-[14.5px] leading-[1.6]">
        Got it. Who are we talking to: other founders, or a broader tech crowd?
      </div>
    </div>

    <div className="shrink-0 px-[14px] pt-1.5 pb-3">
      <div className="flex h-11 items-center rounded-[22px] border border-[color-mix(in_oklch,var(--border)_70%,transparent)] bg-white/90 px-[14px] text-[13px] text-muted-foreground">
        Reply to the agent…
      </div>
    </div>
  </div>
)
