/**
 * @license
 * Copyright 2025 BrowserOS
 * SPDX-License-Identifier: AGPL-3.0-or-later
 *
 * BrowserClaw audit-log cleanup thresholds. Shared across claw-server
 * (route validation, service predicate) and claw-app (dialog options)
 * so the three offered thresholds never drift.
 */

export const AUDIT_CLEANUP_THRESHOLD_DAYS = [15, 30, 90] as const

export type AuditCleanupThresholdDays =
  (typeof AUDIT_CLEANUP_THRESHOLD_DAYS)[number]
