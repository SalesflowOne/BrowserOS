/**
 * @license
 * Copyright 2026 BrowserOS
 * SPDX-License-Identifier: AGPL-3.0-or-later
 */

import type { ReplayEvent } from '@/modules/api/replay.hooks'

export const EMPTY_REPLAY_EVENTS: readonly ReplayEvent[] = []

export interface ReplayEventTargets {
  targetIds: string[]
  eventsForTarget: (targetId: string) => readonly ReplayEvent[]
}

export function resolveSelectedTargetId(
  selectedTargetId: string | null,
  targetIds: readonly string[],
): string | null {
  if (selectedTargetId && targetIds.includes(selectedTargetId)) {
    return selectedTargetId
  }
  return targetIds[0] ?? null
}

/** Groups rrweb events by tab while preserving each tab array's identity. */
export function buildReplayEventTargets(
  events: readonly ReplayEvent[],
): ReplayEventTargets {
  if (events.length === 0) {
    return {
      targetIds: [],
      eventsForTarget: () => EMPTY_REPLAY_EVENTS,
    }
  }

  const targetIds: string[] = []
  const eventsByTarget = new Map<string, ReplayEvent[]>()
  for (const event of events) {
    const list = eventsByTarget.get(event.targetId)
    if (list) {
      list.push(event)
    } else {
      eventsByTarget.set(event.targetId, [event])
      targetIds.push(event.targetId)
    }
  }

  return {
    targetIds,
    eventsForTarget: (targetId) =>
      eventsByTarget.get(targetId) ?? EMPTY_REPLAY_EVENTS,
  }
}
