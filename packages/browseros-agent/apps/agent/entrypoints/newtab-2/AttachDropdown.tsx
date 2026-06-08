import { Check, Globe, Paperclip } from 'lucide-react'
import {
  type ChangeEventHandler,
  type FC,
  type ReactNode,
  useMemo,
  useRef,
  useState,
} from 'react'
import { useAvailableTabs } from '@/components/elements/use-available-tabs'
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
  CommandSeparator,
} from '@/components/ui/command'
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from '@/components/ui/popover'
import { cn } from '@/lib/utils'

interface AttachDropdownProps {
  selectedTabs: chrome.tabs.Tab[]
  onToggleTab: (tab: chrome.tabs.Tab) => void
  onAddFiles: (files: File[]) => void
  children: ReactNode
}

export const AttachDropdown: FC<AttachDropdownProps> = ({
  selectedTabs,
  onToggleTab,
  onAddFiles,
  children,
}) => {
  const [open, setOpen] = useState(false)
  const [query, setQuery] = useState('')
  const fileInputRef = useRef<HTMLInputElement>(null)

  const { tabs } = useAvailableTabs({ enabled: open, filterText: query })
  const selectedTabIds = useMemo(
    () => new Set(selectedTabs.map((t) => t.id)),
    [selectedTabs],
  )

  const openFilePicker = () => {
    setOpen(false)
    fileInputRef.current?.click()
  }

  const handleFilesChosen: ChangeEventHandler<HTMLInputElement> = (e) => {
    const list = e.target.files
    if (!list || list.length === 0) return
    onAddFiles(Array.from(list))
    e.target.value = ''
  }

  return (
    <>
      <Popover open={open} onOpenChange={setOpen}>
        <PopoverTrigger asChild>{children}</PopoverTrigger>
        <PopoverContent
          align="start"
          sideOffset={6}
          className="w-[420px] overflow-hidden p-0"
        >
          <Command shouldFilter={false}>
            <CommandInput
              value={query}
              onValueChange={setQuery}
              placeholder="Search tabs or files…"
            />
            <CommandList className="max-h-[360px]">
              <CommandGroup heading="Attach">
                <CommandItem
                  value="__attach_files__"
                  onSelect={openFilePicker}
                  className="gap-2"
                >
                  <Paperclip className="size-4 text-muted-foreground" />
                  <span>Attach files…</span>
                </CommandItem>
              </CommandGroup>

              <CommandSeparator />

              <CommandGroup heading={`Open tabs (${tabs.length})`}>
                {tabs.length === 0 ? (
                  <CommandEmpty>
                    {query
                      ? `No tabs match "${query}"`
                      : 'No tabs open in this window'}
                  </CommandEmpty>
                ) : (
                  tabs.map((tab) => {
                    const isSelected =
                      tab.id != null && selectedTabIds.has(tab.id)
                    return (
                      <CommandItem
                        key={tab.id}
                        value={String(tab.id)}
                        onSelect={() => onToggleTab(tab)}
                        className="gap-2"
                      >
                        <span
                          className={cn(
                            'flex size-4 shrink-0 items-center justify-center rounded-[4px] border',
                            isSelected
                              ? 'border-[var(--accent-orange)] bg-[var(--accent-orange)]'
                              : 'border-border bg-background',
                          )}
                          aria-hidden
                        >
                          {isSelected && (
                            <Check className="size-3 text-white" />
                          )}
                        </span>
                        <TabFavicon url={tab.favIconUrl} />
                        <span className="min-w-0 flex-1">
                          <span className="block truncate font-medium text-foreground text-xs">
                            {tab.title || tab.url || 'Untitled tab'}
                          </span>
                          <span className="block truncate text-[10px] text-muted-foreground">
                            {tab.url}
                          </span>
                        </span>
                      </CommandItem>
                    )
                  })
                )}
              </CommandGroup>
            </CommandList>
          </Command>
        </PopoverContent>
      </Popover>

      <input
        ref={fileInputRef}
        type="file"
        multiple
        hidden
        aria-hidden
        onChange={handleFilesChosen}
      />
    </>
  )
}

const TabFavicon: FC<{ url?: string }> = ({ url }) =>
  url ? (
    <img src={url} alt="" className="size-3.5 shrink-0 rounded-[2px]" />
  ) : (
    <Globe className="size-3.5 shrink-0 text-muted-foreground" />
  )
