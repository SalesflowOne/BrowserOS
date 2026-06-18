/**
 * @license
 * Copyright 2025 BrowserOS
 */

import { describe, expect, it } from 'bun:test'
import { buildLegacyBrowserToolSet } from '../../src/agent/tool-adapter'
import type { Browser } from '../../src/browser/browser'

const fakeBrowser = {} as unknown as Browser

describe('buildLegacyBrowserToolSet GUI mode', () => {
  const guiTools = buildLegacyBrowserToolSet(fakeBrowser, {
    gui: { molmoEndpoint: 'https://molmo.example.com/' },
  })
  const names = new Set(Object.keys(guiTools))

  it('exposes the MolmoPoint pointing tools', () => {
    expect(names.has('click')).toBe(true)
    expect(names.has('hover')).toBe(true)
    expect(names.has('type')).toBe(true)
  })

  it('removes element-ID and DOM-tree tools', () => {
    for (const removed of [
      'take_snapshot',
      'get_dom',
      'search_dom',
      'fill',
      'focus',
      'clear',
      'check',
      'uncheck',
      'select_option',
      'drag',
      'download_file',
      'upload_file',
    ]) {
      expect(names.has(removed)).toBe(false)
    }
  })

  it('keeps vision-friendly perception and navigation tools', () => {
    for (const kept of [
      'take_screenshot',
      'get_page_content',
      'get_page_links',
      'scroll',
      'navigate_page',
      'new_page',
      'close_page',
      'click_at',
    ]) {
      expect(names.has(kept)).toBe(true)
    }
  })

  it('leaves the element-ID surface intact when gui is not set', () => {
    const normal = buildLegacyBrowserToolSet(fakeBrowser, {})
    const normalNames = new Set(Object.keys(normal))
    expect(normalNames.has('take_snapshot')).toBe(true)
    expect(normalNames.has('fill')).toBe(true)
    // Without GUI mode, `click` is the element-ID tool, not a pointing tool.
    expect(normalNames.has('type')).toBe(false)
  })
})
