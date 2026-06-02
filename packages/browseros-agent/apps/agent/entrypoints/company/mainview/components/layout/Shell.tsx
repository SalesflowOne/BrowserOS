import { SearchPalette } from '@company/components/search/SearchPalette'
import {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarHeader,
  SidebarInset,
  SidebarProvider,
} from '@company/components/ui/sidebar'
import * as searchPaletteSignal from '@company/lib/searchPaletteSignal'
import { type FC, type ReactNode, useEffect } from 'react'
import { BrowserosBanner } from './BrowserosBanner'
import { InsetTopBar } from './InsetTopBar'
import { Rail, ThemeToggle } from './Rail'

// Global Cmd+K / Ctrl+K listener — wins over input / textarea focus
// inside the renderer. Toggles the palette so the same shortcut also
// closes it. Lives in Shell because Shell mounts exactly once across
// all routes.
function useSearchPaletteShortcut(): void {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key.toLowerCase() !== 'k') return
      if (!(e.metaKey || e.ctrlKey)) return
      e.preventDefault()
      searchPaletteSignal.toggle()
    }
    window.addEventListener('keydown', onKey)
    return () => {
      window.removeEventListener('keydown', onKey)
    }
  }, [])
}

// Sidebar uses offcanvas so collapsing slides it fully out of the way
// rather than leaving a useless icon rail. All persistent chrome
// (sidebar toggle, back / forward, traffic-light gap when needed)
// lives in the inset's top bar so it's reachable regardless of state.
// The sidebar's own header is a thin drag strip so the window can be
// moved from the rail's top edge when it's open.
export const Shell: FC<{ children: ReactNode }> = ({ children }) => {
  useSearchPaletteShortcut()
  return (
    <SidebarProvider className="h-svh max-h-svh overflow-hidden">
      <Sidebar collapsible="offcanvas">
        <SidebarHeader className="p-0">
          {/* Border lives on the same h-9 element as the inset top bar
              so both bottom borders land on the exact same y-coord;
              otherwise the sidebar-header border-b sits 1 px below the
              inset top bar's border-b because the outer SidebarHeader
              wraps an h-9 child instead of being h-9 itself. */}
          <div className="app-region-drag flex h-9 items-center border-border/50 border-b px-3 darwin:pl-20">
            <span className="select-none truncate font-medium text-[12px] text-foreground/80 tracking-tight">
              BrowserClaw
            </span>
          </div>
        </SidebarHeader>
        <SidebarContent>
          <Rail />
        </SidebarContent>
        <SidebarFooter className="border-border/50 border-t">
          <ThemeToggle />
        </SidebarFooter>
      </Sidebar>
      <SidebarInset className="flex min-h-0 flex-col overflow-hidden">
        <InsetTopBar />
        <BrowserosBanner />
        <div className="flex min-h-0 flex-1 flex-col">{children}</div>
      </SidebarInset>
      {/* Single global palette instance — opens via the rail button or
          the Cmd+K listener above. */}
      <SearchPalette />
    </SidebarProvider>
  )
}
