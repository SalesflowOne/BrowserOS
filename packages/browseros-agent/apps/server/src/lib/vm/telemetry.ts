/**
 * @license
 * Copyright 2025 BrowserOS
 * SPDX-License-Identifier: AGPL-3.0-or-later
 */

export const VM_TELEMETRY_EVENTS = {
  ensureReadyStart: 'vm.ensure_ready.start',
  ensureReadyOk: 'vm.ensure_ready.ok',
  create: 'vm.create',
  start: 'vm.start',
  stop: 'vm.stop',
  upgradeDetected: 'vm.upgrade.detected',
  upgradeSwap: 'vm.upgrade.swap',
  upgradeReplay: 'vm.upgrade.replay',
  resetDetected: 'vm.reset.detected',
  resetOk: 'vm.reset.ok',
  socketWaitTimeout: 'vm.socket_wait.timeout',
  manifestMissing: 'vm.manifest.missing',
  migrationOpenClawMoved: 'vm.migration.openclaw_moved',
  migrationLegacyPodmanDetected: 'vm.migration.legacy_podman_detected',
} as const
