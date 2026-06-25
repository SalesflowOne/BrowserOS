import { describe, expect, it } from 'bun:test'
import { Children, isValidElement, type ReactNode } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { MemoryRouter } from 'react-router'
import { Button } from '@/components/ui/button'
import { STARTER_PROMPTS } from '../onboarding-v2.helpers'
import { ReadyStep } from './ReadyStep'

function render(): string {
  return renderToStaticMarkup(
    <MemoryRouter>
      <ReadyStep onDone={() => undefined} />
    </MemoryRouter>,
  )
}

type ClickableElement = {
  props: {
    children?: ReactNode
    onClick?: () => void
  }
}

function containsText(node: ReactNode, text: string): boolean {
  if (typeof node === 'string' || typeof node === 'number') {
    return String(node).includes(text)
  }
  if (Array.isArray(node)) {
    return node.some((child) => containsText(child, text))
  }
  if (isValidElement<{ children?: ReactNode }>(node)) {
    return containsText(node.props.children, text)
  }
  return false
}

function findCompletionButton(node: ReactNode): ClickableElement | null {
  if (!isValidElement<{ children?: ReactNode; onClick?: () => void }>(node)) {
    return null
  }
  if (
    node.type === Button &&
    containsText(node.props.children, 'Open BrowserOS')
  ) {
    return node
  }
  for (const child of Children.toArray(node.props.children)) {
    const match = findCompletionButton(child)
    if (match) return match
  }
  return null
}

describe('ReadyStep', () => {
  it('renders the Open BrowserOS CTA', () => {
    expect(render()).toContain('Open BrowserOS')
  })

  it('renders the first two starter prompts from the fixture', () => {
    const html = render()
    expect(html).toContain(STARTER_PROMPTS[0])
    expect(html).toContain(STARTER_PROMPTS[1])
  })

  it('wires the Open BrowserOS CTA to the completion handler', () => {
    let calls = 0
    const tree = ReadyStep({ onDone: () => calls++ })
    const button = findCompletionButton(tree)

    expect(button).not.toBeNull()
    button?.props.onClick?.()

    expect(calls).toBe(1)
  })
})
