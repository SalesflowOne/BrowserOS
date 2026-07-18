/**
 * @license
 * Copyright 2026 BrowserOS
 * SPDX-License-Identifier: AGPL-3.0-or-later
 *
 * Pure unit tests for `buildTabView`. Lives in `tab-view.ts` (not
 * `replay.data.ts`) so bun test does not import the react-query-kit
 * hook graph, which sibling tests `mock.module`-poison globally.
 */

import { describe, expect, it } from 'bun:test'
import type { ReplayEvent, ReplayFrame } from '@/modules/api/replay.hooks'
import {
  buildReplayEventTargets,
  resolveSelectedTargetId,
} from './replay-events'
import { type BuildTabViewInput, buildTabView } from './tab-view'

function frame(
  t: number,
  targetId: string | null,
  extra: Partial<ReplayFrame> = {},
): ReplayFrame {
  return {
    t,
    kind: 'action',
    verb: 'read',
    node: 'test',
    caption: 'test',
    targetId,
    ...extra,
  }
}

function event(ts: number, targetId: string): ReplayEvent {
  return { sessionId: 'test', targetId, tabId: 1, type: 3, data: {}, ts }
}

function makeInput(
  overrides: Partial<BuildTabViewInput> = {},
): BuildTabViewInput {
  return {
    frames: [],
    eventsForTarget: () => [],
    startedAtMs: 1_000_000,
    ...overrides,
  }
}

describe('buildTabView', () => {
  it('returns EMPTY for a null target id', () => {
    const v = buildTabView(makeInput(), null)
    expect(v.frames).toEqual([])
    expect(v.events).toEqual([])
    expect(v.totalSeconds).toBe(0)
  })

  it('returns EMPTY when the tab has no frames AND no events', () => {
    const v = buildTabView(
      makeInput({ frames: [frame(5, 'target-1')] }),
      'target-42',
    )
    expect(v.frames).toEqual([])
    expect(v.events).toEqual([])
    expect(v.totalSeconds).toBe(0)
  })

  it('filters frames to only the target tab', () => {
    const v = buildTabView(
      makeInput({
        frames: [
          frame(1, 'target-1'),
          frame(2, 'target-4'),
          frame(3, 'target-1'),
          frame(4, 'target-5'),
        ],
      }),
      'target-1',
    )
    expect(v.frames).toHaveLength(2)
    expect(v.frames.map((f) => f.targetId)).toEqual(['target-1', 'target-1'])
  })

  it('shifts frame `t` to be tab-relative (first frame at t=0)', () => {
    const v = buildTabView(
      makeInput({
        frames: [
          frame(5, 'target-7'),
          frame(8, 'target-7'),
          frame(12, 'target-7'),
        ],
        eventsForTarget: () => [
          event(1_005_000, 'target-7'),
          event(1_012_000, 'target-7'),
        ],
      }),
      'target-7',
    )
    expect(v.frames.map((f) => f.t)).toEqual([0, 3, 7])
  })

  it('totalSeconds = tab activity window (last event - first event)', () => {
    const v = buildTabView(
      makeInput({
        frames: [frame(3, 'target-1'), frame(6, 'target-1')],
        eventsForTarget: () => [
          event(1_003_000, 'target-1'),
          event(1_007_500, 'target-1'),
        ],
      }),
      'target-1',
    )
    expect(v.totalSeconds).toBeCloseTo(4.5)
  })

  it('falls back to frame timespan when no events exist', () => {
    const v = buildTabView(
      makeInput({
        frames: [frame(2, 'target-9'), frame(10, 'target-9')],
        eventsForTarget: () => [],
      }),
      'target-9',
    )
    expect(v.totalSeconds).toBe(8)
    expect(v.frames.map((f) => f.t)).toEqual([0, 8])
  })

  it('preserves other frame fields when shifting `t`', () => {
    const v = buildTabView(
      makeInput({
        frames: [
          frame(5, 'target-3', {
            verb: 'navigate',
            url: 'https://example.com',
          }),
        ],
      }),
      'target-3',
    )
    expect(v.frames[0]?.verb).toBe('navigate')
    expect(v.frames[0]?.url).toBe('https://example.com')
    expect(v.frames[0]?.targetId).toBe('target-3')
    expect(v.frames[0]?.t).toBe(0)
  })

  it('keeps a tab events array stable across task-only data changes', () => {
    const eventTargets = buildReplayEventTargets([
      event(1_002_000, 'target-3'),
      event(1_003_000, 'target-3'),
      event(1_004_000, 'target-8'),
    ])
    const first = buildTabView(
      makeInput({
        frames: [frame(2, 'target-3')],
        eventsForTarget: eventTargets.eventsForTarget,
      }),
      'target-3',
    )
    const afterTaskPoll = buildTabView(
      makeInput({
        frames: [frame(2, 'target-3'), frame(4, 'target-3')],
        eventsForTarget: eventTargets.eventsForTarget,
      }),
      'target-3',
    )

    expect(afterTaskPoll.events).toBe(first.events)
    expect(afterTaskPoll.frames).not.toBe(first.frames)
  })
})

describe('resolveSelectedTargetId', () => {
  it('keeps a selection that exists in the next replay', () => {
    expect(resolveSelectedTargetId('target-b', ['target-a', 'target-b'])).toBe(
      'target-b',
    )
  })

  it('selects the first target when the previous replay target is absent', () => {
    expect(resolveSelectedTargetId('old-target', ['new-target'])).toBe(
      'new-target',
    )
    expect(resolveSelectedTargetId('old-target', [])).toBeNull()
  })
})
