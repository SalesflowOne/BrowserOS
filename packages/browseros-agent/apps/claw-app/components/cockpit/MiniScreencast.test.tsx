/**
 * @license
 * Copyright 2025 BrowserOS
 * SPDX-License-Identifier: AGPL-3.0-or-later
 */

import { describe, expect, it } from 'bun:test'
import { renderToStaticMarkup } from 'react-dom/server'
import { tabPreviewUrl } from '@/modules/api/tabs.hooks'
import { MiniScreencast } from './MiniScreencast'

describe('MiniScreencast', () => {
  it('renders the placeholder globe + host when no screencast is supplied', () => {
    const html = renderToStaticMarkup(
      <MiniScreencast site="example.com" pageId={7} />,
    )
    expect(html).toContain('example.com')
    expect(html).not.toContain('data:image/jpeg;base64,')
  })

  it('keys the canonical JPEG URL by page and capture time', () => {
    expect(tabPreviewUrl(7, 123, 'http://127.0.0.1:9200')).toBe(
      'http://127.0.0.1:9200/api/v1/tabs/7/preview?capturedAt=123',
    )
  })

  it('falls back to placeholder before a preview has been captured', () => {
    const html = renderToStaticMarkup(
      <MiniScreencast site="example.com" pageId={7} />,
    )
    expect(html).not.toContain('data:image/jpeg;base64,')
    expect(html).toContain('example.com')
  })

  it('shows the live dot when live=true', () => {
    const html = renderToStaticMarkup(
      <MiniScreencast site="example.com" pageId={7} live />,
    )
    expect(html).toMatch(/animate-pulse-dot/)
  })

  it('does not show the live dot when live is false', () => {
    const html = renderToStaticMarkup(
      <MiniScreencast site="example.com" pageId={7} />,
    )
    expect(html).not.toMatch(/animate-pulse-dot/)
  })
})
