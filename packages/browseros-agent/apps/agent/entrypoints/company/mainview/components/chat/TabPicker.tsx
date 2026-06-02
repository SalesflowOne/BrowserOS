import { cn } from '@company/lib/utils'
import type { BrowserTab } from '@company/modules/api/browseros.hooks'
import { type ReactNode, useEffect, useRef } from 'react'

interface Props {
  tabs: BrowserTab[]
  filter: string
  selectedIndex: number
  loading: boolean
  degraded: boolean
  degradedMessage?: string
  onSelect: (tab: BrowserTab) => void
  onHover: (index: number) => void
}

export function TabPicker({
  tabs,
  filter,
  selectedIndex,
  loading,
  degraded,
  degradedMessage,
  onSelect,
  onHover,
}: Props) {
  const scrollRef = useRef<HTMLDivElement>(null)
  // biome-ignore lint/correctness/useExhaustiveDependencies: selectedIndex drives the scroll via DOM query, not a direct reference
  useEffect(() => {
    const selected = scrollRef.current?.querySelector<HTMLElement>(
      '[data-selected="true"]',
    )
    selected?.scrollIntoView({ block: 'nearest' })
  }, [selectedIndex])

  if (loading) {
    return (
      <PickerFrame>
        <div className="px-4 py-5 text-center text-muted-foreground text-xs">
          Loading tabs…
        </div>
      </PickerFrame>
    )
  }

  if (degraded) {
    return (
      <PickerFrame>
        <div className="px-4 py-5 text-center">
          <p className="font-medium text-foreground text-sm">
            Couldn't reach BrowserOS
          </p>
          <p className="mt-1 text-muted-foreground text-xs">
            {degradedMessage ?? 'Try again in a moment.'}
          </p>
        </div>
      </PickerFrame>
    )
  }

  if (tabs.length === 0) {
    return (
      <PickerFrame>
        <div className="px-4 py-5 text-center">
          <p className="font-medium text-foreground text-sm">No tabs open</p>
          <p className="mt-1 text-muted-foreground text-xs">
            Open a page in this chat's BrowserOS window first.
          </p>
        </div>
      </PickerFrame>
    )
  }

  const lc = filter.toLowerCase()
  const visible = lc
    ? tabs.filter(
        (t) =>
          t.title.toLowerCase().includes(lc) ||
          t.url.toLowerCase().includes(lc),
      )
    : tabs

  if (visible.length === 0) {
    return (
      <PickerFrame>
        <div className="px-4 py-4 text-center text-muted-foreground text-xs">
          No matching tabs — backspace to refine or Esc to dismiss
        </div>
      </PickerFrame>
    )
  }

  return (
    <PickerFrame>
      <div ref={scrollRef} className="min-h-0 flex-1 overflow-y-auto p-1">
        {visible.map((tab, i) => (
          <TabItem
            key={tab.pageId}
            tab={tab}
            selected={i === selectedIndex}
            flatIndex={i}
            onSelect={onSelect}
            onHover={onHover}
          />
        ))}
      </div>
    </PickerFrame>
  )
}

function PickerFrame({ children }: { children: ReactNode }) {
  return (
    <div className="flex max-h-80 flex-col overflow-hidden rounded-xl border border-border/60 bg-popover shadow-lg ring-1 ring-foreground/5">
      {children}
      <div className="shrink-0 border-border/60 border-t px-3 py-1.5">
        <span className="text-muted-foreground text-xs">
          ↑↓ navigate · Enter select · Esc dismiss
        </span>
      </div>
    </div>
  )
}

interface TabItemProps {
  tab: BrowserTab
  selected: boolean
  flatIndex: number
  onSelect: (tab: BrowserTab) => void
  onHover: (index: number) => void
}

function TabItem({
  tab,
  selected,
  flatIndex,
  onSelect,
  onHover,
}: TabItemProps) {
  return (
    <button
      type="button"
      data-selected={selected ? 'true' : undefined}
      onMouseEnter={() => onHover(flatIndex)}
      onClick={() => onSelect(tab)}
      className={cn(
        'group relative flex w-full items-center gap-3 rounded-sm px-3 py-1.5 text-left text-sm outline-none transition-colors',
        'hover:bg-muted data-[selected=true]:bg-muted',
      )}
    >
      <span
        className={cn(
          'absolute top-1/2 left-1 h-[18px] w-0.5 -translate-y-1/2 rounded-full bg-[color:var(--accent-orange)] transition-opacity',
          selected ? 'opacity-100' : 'opacity-0',
        )}
      />
      <span
        className={cn(
          'min-w-0 flex-1 truncate pl-1 text-sm',
          selected ? 'font-semibold text-foreground' : 'text-foreground/85',
        )}
      >
        {tab.title || tab.url}
      </span>
      <span className="min-w-0 max-w-[40%] truncate text-muted-foreground text-xs">
        {stripScheme(tab.url)}
      </span>
    </button>
  )
}

function stripScheme(url: string): string {
  return url.replace(/^https?:\/\//, '')
}
