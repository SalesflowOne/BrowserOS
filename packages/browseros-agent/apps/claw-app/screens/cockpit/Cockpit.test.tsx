import { describe, expect, it, mock } from 'bun:test'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { renderToStaticMarkup } from 'react-dom/server'
import { MemoryRouter } from 'react-router'

mock.module('./cockpit.data', () => ({
  useCockpitData: () => ({
    agents: [],
    activity: [],
    isPending: false,
  }),
}))

mock.module('@/modules/api/audit.hooks', () => ({
  useTasks: () => ({
    data: { pages: [{ tasks: [], nextCursor: null }] },
    isPending: false,
  }),
  taskScreenshotUrl: (id: number) => `/audit/screenshot/${id}`,
  useTaskScreenshotBaseUrl: () => null,
}))

mock.module('@/modules/api/connections.hooks', () => ({
  useBrowserosConnections: () => ({
    data: { connections: [] },
  }),
}))

const { Cockpit } = await import('./Cockpit')

function renderApp(): string {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  })
  return renderToStaticMarkup(
    <QueryClientProvider client={client}>
      <MemoryRouter>
        <Cockpit />
      </MemoryRouter>
    </QueryClientProvider>,
  )
}

describe('Cockpit (v2)', () => {
  it('renders the first-run hero and hides the running grid when no agents exist', () => {
    const html = renderApp()
    expect(html).toContain('You watch. Your agent')
    expect(html).toContain(
      'https://cdn.browseros.com/artifacts/claw/onboarding-video/v0.1.0/first-run-demo.mp4',
    )
    expect(html).not.toContain('Running now')
  })

  it('does NOT render an add-profile tile in the default v2 build', () => {
    const html = renderApp()
    expect(html).not.toContain('New profile')
    expect(html).not.toContain('harness . logins . guardrails')
  })

  it('shows the first-run shell when there are no connections or runs', () => {
    const html = renderApp()
    expect(html).not.toContain('No agents connected')
    expect(html).not.toContain('Running now')
    expect(html).toContain('Set up MCP endpoint')
    expect(html).toContain(
      'Use BrowserClaw. Book me the cheapest morning flight',
    )
  })
})
