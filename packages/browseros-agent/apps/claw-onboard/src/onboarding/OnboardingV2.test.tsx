import { afterEach, describe, expect, it } from 'bun:test'
import { renderToStaticMarkup } from 'react-dom/server'
import { MemoryRouter } from 'react-router'
import { OnboardingV2, openBrowserOsHome } from './OnboardingV2'

const originalWindow = globalThis.window

function renderApp(): string {
  return renderToStaticMarkup(
    <MemoryRouter>
      <OnboardingV2 />
    </MemoryRouter>,
  )
}

function installAssignableWindow(search: string) {
  let assignedUrl: string | null = null
  Object.defineProperty(globalThis, 'window', {
    configurable: true,
    value: {
      location: {
        search,
        assign(url: string) {
          assignedUrl = url
        },
      },
      sessionStorage: {
        getItem() {
          return null
        },
        setItem() {},
      },
    },
  })
  return () => assignedUrl
}

afterEach(() => {
  Object.defineProperty(globalThis, 'window', {
    configurable: true,
    value: originalWindow,
  })
})

describe('OnboardingV2 shell', () => {
  it('lands on step 0 with the welcome heading and primary CTA', () => {
    const html = renderApp()
    expect(html).toContain('The browser your agents')
    expect(html).toContain('drive')
    expect(html).toContain('Set up')
  })

  it('renders the visual rail with the v2 quote and three feature blocks', () => {
    const html = renderApp()
    expect(html).toContain('BrowserOS')
    expect(html).toContain('Let the agent you already run')
    expect(html).toContain('Fast &amp; token-cheap')
    expect(html).toContain('Logged in as you')
    expect(html).toContain('Under your control')
  })

  it('renders the macwin chrome bar title', () => {
    const html = renderApp()
    expect(html).toContain('Welcome to BrowserOS')
  })

  it('renders four step dots', () => {
    const html = renderApp()
    const matches = html.match(/h-\[7px\]/g) ?? []
    expect(matches.length).toBeGreaterThanOrEqual(4)
  })

  it('opens the resolved BrowserOS cockpit URL when onboarding completes', () => {
    const getAssignedUrl = installAssignableWindow(
      '?apiUrl=http%3A%2F%2F127.0.0.1%3A9234%2Fcockpit',
    )

    openBrowserOsHome()

    expect(getAssignedUrl()).toBe('http://127.0.0.1:9234/cockpit')
  })
})
