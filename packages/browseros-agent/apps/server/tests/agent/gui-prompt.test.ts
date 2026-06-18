/**
 * @license
 * Copyright 2025 BrowserOS
 */

import { describe, expect, it } from 'bun:test'

import { buildSystemPrompt } from '../../src/agent/prompt'

describe('buildSystemPrompt GUI mode', () => {
  it('renders the gui-browser-control section and points at the GUI tools', () => {
    const prompt = buildSystemPrompt({
      guiOnly: true,
      exclude: ['capabilities'],
    })
    expect(prompt).toContain('GUI (vision) mode')
    expect(prompt).toContain('There are no element IDs')
    expect(prompt).toContain('`click`')
    expect(prompt).toContain('`type`')
    expect(prompt).toContain('`take_screenshot`')
  })

  it('omits the gui-browser-control section when guiOnly is not set', () => {
    const prompt = buildSystemPrompt({})
    expect(prompt).not.toContain('GUI (vision) mode')
  })
})
