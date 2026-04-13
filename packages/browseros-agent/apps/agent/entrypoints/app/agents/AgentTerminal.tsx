import { FitAddon } from '@xterm/addon-fit'
import { WebLinksAddon } from '@xterm/addon-web-links'
import { Terminal } from '@xterm/xterm'
import { ArrowLeft } from 'lucide-react'
import { type FC, useEffect, useRef } from 'react'
import '@xterm/xterm/css/xterm.css'
import { Button } from '@/components/ui/button'
import { getAgentServerUrl } from '@/lib/browseros/helpers'

interface AgentTerminalProps {
  onBack: () => void
}

type TerminalServerMessage =
  | { type: 'output'; data: string }
  | { type: 'exit'; exitCode: number }
  | { type: 'error'; message: string }

const TERMINAL_HOME_DIR = '/home/node/.openclaw'
const TERMINAL_FONT_FAMILY =
  '"Geist Mono", Menlo, Monaco, "Courier New", monospace'

function resolveCssColor(variableName: string): string {
  const probe = document.createElement('div')
  probe.style.position = 'fixed'
  probe.style.visibility = 'hidden'
  probe.style.pointerEvents = 'none'
  probe.style.color = `var(${variableName})`
  document.body.append(probe)
  const color = window.getComputedStyle(probe).color
  probe.remove()
  return color
}

function withAlpha(color: string, alpha: number): string {
  const channels = color.match(/[\d.]+/g)
  if (!channels || channels.length < 3) return color
  const [red, green, blue] = channels
  return `rgb(${red} ${green} ${blue} / ${alpha})`
}

function createTerminalTheme() {
  const isDark = document.documentElement.classList.contains('dark')
  const background = resolveCssColor('--background')
  const foreground = resolveCssColor('--foreground')
  const muted = resolveCssColor('--muted-foreground')
  const accent = resolveCssColor('--accent-orange')

  return {
    background,
    foreground,
    cursor: foreground,
    cursorAccent: background,
    selectionBackground: withAlpha(accent, isDark ? 0.3 : 0.2),
    selectionForeground: foreground,
    black: isDark ? '#16131a' : '#1f1b22',
    red: isDark ? '#ef8c7c' : '#c25544',
    green: isDark ? '#9ac67c' : '#5c8754',
    yellow: isDark ? '#e5c07b' : '#b7791f',
    blue: isDark ? '#8ba9ff' : '#4667d8',
    magenta: isDark ? '#d2a8ff' : '#955ec7',
    cyan: isDark ? '#7fd4d1' : '#0f766e',
    white: isDark ? '#e8e0d9' : '#f7f1eb',
    brightBlack: muted,
    brightRed: isDark ? '#ffb0a4' : '#dc7b6d',
    brightGreen: isDark ? '#b6d99e' : '#7bab74',
    brightYellow: isDark ? '#f2d59b' : '#d49a44',
    brightBlue: isDark ? '#b3c4ff' : '#6f8cf0',
    brightMagenta: isDark ? '#e2c6ff' : '#b789dd',
    brightCyan: isDark ? '#a6ece7' : '#3aa5a0',
    brightWhite: isDark ? '#fff8f1' : '#ffffff',
  }
}

function parseTerminalMessage(data: unknown): TerminalServerMessage | null {
  if (typeof data !== 'string') return null

  let parsed: unknown
  try {
    parsed = JSON.parse(data) as unknown
  } catch {
    return null
  }
  if (
    parsed &&
    typeof parsed === 'object' &&
    'type' in parsed &&
    parsed.type === 'output' &&
    'data' in parsed &&
    typeof parsed.data === 'string'
  ) {
    return { type: 'output', data: parsed.data }
  }
  if (
    parsed &&
    typeof parsed === 'object' &&
    'type' in parsed &&
    parsed.type === 'error' &&
    'message' in parsed &&
    typeof parsed.message === 'string'
  ) {
    return { type: 'error', message: parsed.message }
  }
  if (
    parsed &&
    typeof parsed === 'object' &&
    'type' in parsed &&
    parsed.type === 'exit' &&
    'exitCode' in parsed &&
    typeof parsed.exitCode === 'number'
  ) {
    return { type: 'exit', exitCode: parsed.exitCode }
  }
  return null
}

export const AgentTerminal: FC<AgentTerminalProps> = ({ onBack }) => {
  const containerRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!containerRef.current) return

    const terminal = new Terminal({
      fontSize: 14,
      fontFamily: TERMINAL_FONT_FAMILY,
      cursorBlink: true,
      cursorStyle: 'block',
      lineHeight: 1.25,
      scrollback: 8000,
      theme: createTerminalTheme(),
    })

    const fitAddon = new FitAddon()
    terminal.loadAddon(fitAddon)
    terminal.loadAddon(new WebLinksAddon())
    terminal.open(containerRef.current)

    let ws: WebSocket | null = null
    let sawExit = false

    const applyTheme = (): void => {
      terminal.options.theme = createTerminalTheme()
    }

    const sendMessage = (
      message:
        | { type: 'input'; data: string }
        | { type: 'resize'; cols: number; rows: number },
    ): void => {
      if (ws?.readyState !== WebSocket.OPEN) return
      ws.send(JSON.stringify(message))
    }

    const sendResize = (cols = terminal.cols, rows = terminal.rows): void => {
      sendMessage({ type: 'resize', cols, rows })
    }

    const connect = async () => {
      const baseUrl = await getAgentServerUrl()
      const wsUrl = new URL('/terminal/ws', baseUrl)
      wsUrl.protocol = wsUrl.protocol === 'https:' ? 'wss:' : 'ws:'

      ws = new WebSocket(wsUrl)

      ws.onopen = () => {
        fitAddon.fit()
        terminal.focus()
        sendResize()
      }

      ws.onmessage = (event) => {
        const message = parseTerminalMessage(event.data)
        if (!message) return

        if (message.type === 'output') {
          terminal.write(message.data)
        } else if (message.type === 'error') {
          terminal.write(`\r\n\x1b[31m${message.message}\x1b[0m\r\n`)
        } else {
          sawExit = true
          terminal.write(
            `\r\n\x1b[90m[session ended with exit ${message.exitCode}]\x1b[0m\r\n`,
          )
        }
      }

      ws.onclose = () => {
        if (sawExit) return
        terminal.write('\r\n\x1b[90m[session ended]\x1b[0m\r\n')
      }

      ws.onerror = () => {
        terminal.write('\r\n\x1b[31m[connection error]\x1b[0m\r\n')
      }

      const inputDisposable = terminal.onData((data) => {
        sendMessage({ type: 'input', data })
      })

      const resizeDisposable = terminal.onResize(({ cols, rows }) => {
        sendResize(cols, rows)
      })

      return () => {
        inputDisposable.dispose()
        resizeDisposable.dispose()
      }
    }

    let disposeSocketBindings: (() => void) | undefined
    void connect().then((disposeBindings) => {
      disposeSocketBindings = disposeBindings
    })

    const resizeObserver = new ResizeObserver(() => {
      fitAddon.fit()
      sendResize()
    })
    resizeObserver.observe(containerRef.current)

    const themeObserver = new MutationObserver(() => {
      applyTheme()
    })
    themeObserver.observe(document.documentElement, {
      attributes: true,
      attributeFilter: ['class'],
    })

    return () => {
      resizeObserver.disconnect()
      themeObserver.disconnect()
      disposeSocketBindings?.()
      ws?.close()
      terminal.dispose()
    }
  }, [])

  return (
    <div className="mx-auto flex h-[calc(100dvh-9rem)] min-h-[32rem] w-full max-w-5xl flex-col py-1 sm:min-h-[42rem] sm:py-3">
      <div className="relative flex min-h-0 flex-1 flex-col overflow-hidden rounded-[1.75rem] border border-border/60 bg-card/95 shadow-[0_24px_60px_-28px_rgba(15,23,42,0.4)] backdrop-blur">
        <div className="pointer-events-none absolute inset-x-0 top-0 h-24 bg-gradient-to-b from-[var(--accent-orange)]/8 to-transparent" />

        <div className="relative flex items-center justify-between gap-3 border-border/60 border-b px-4 py-3 sm:px-5">
          <div className="flex min-w-0 items-center gap-3">
            <Button variant="ghost" size="icon" onClick={onBack}>
              <ArrowLeft className="size-4" />
            </Button>
            <div className="min-w-0">
              <div className="truncate font-semibold text-sm">
                Container Terminal
              </div>
              <div className="truncate text-muted-foreground text-sm">
                OpenClaw shell in {TERMINAL_HOME_DIR}
              </div>
            </div>
          </div>
          <div className="hidden items-center gap-2 sm:flex">
            <span className="rounded-full border border-border/60 bg-background/70 px-2.5 py-1 font-mono text-[11px] text-muted-foreground">
              fish
            </span>
            <span className="rounded-full border border-border/60 bg-background/70 px-2.5 py-1 text-[11px] text-muted-foreground">
              container
            </span>
          </div>
        </div>

        <div className="relative min-h-0 flex-1 p-3 sm:p-4">
          <div className="agent-terminal-shell flex h-full min-h-0 flex-col overflow-hidden rounded-[1.35rem] border border-border/70 bg-background shadow-[inset_0_1px_0_rgba(255,255,255,0.04)]">
            <div className="flex items-center gap-2 border-border/60 border-b bg-muted/35 px-4 py-2.5">
              <span className="size-2.5 rounded-full bg-[#ff5f57]/85" />
              <span className="size-2.5 rounded-full bg-[#febc2e]/85" />
              <span className="size-2.5 rounded-full bg-[#28c840]/85" />
              <div className="ml-2 truncate font-mono text-[11px] text-muted-foreground">
                {TERMINAL_HOME_DIR}
              </div>
            </div>

            <div className="min-h-0 flex-1 px-4 py-4 sm:px-5 sm:py-5">
              <div ref={containerRef} className="h-full w-full" />
            </div>
          </div>
        </div>

        <div className="flex items-center justify-between gap-3 border-border/60 border-t bg-background/40 px-4 py-2 text-[11px] text-muted-foreground sm:px-5">
          <span>
            Interactive shell attached to the running OpenClaw container
          </span>
          <span className="font-mono">TERM=xterm-256color</span>
        </div>
      </div>
    </div>
  )
}
