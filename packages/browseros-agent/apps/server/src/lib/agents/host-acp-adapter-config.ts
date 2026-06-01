/**
 * @license
 * Copyright 2025 BrowserOS
 * SPDX-License-Identifier: AGPL-3.0-or-later
 */

export type HostAcpAdapter = 'claude' | 'codex'

export const HOST_ACP_ADAPTER_CONFIG = {
  claude: {
    displayName: 'Claude Code',
    nativeBinary: 'claude',
    acpCommand: 'npx -y @agentclientprotocol/claude-agent-acp@^0.31.0',
    acpPackageSpec: '@agentclientprotocol/claude-agent-acp@^0.31.0',
    acpPackageName: '@agentclientprotocol/claude-agent-acp',
    acpBin: 'claude-agent-acp',
  },
  codex: {
    displayName: 'Codex',
    nativeBinary: 'codex',
    acpCommand: 'npx -y @zed-industries/codex-acp@^0.12.0',
    acpPackageSpec: '@zed-industries/codex-acp@^0.12.0',
    acpPackageName: '@zed-industries/codex-acp',
    acpBin: 'codex-acp',
  },
} as const satisfies Record<
  HostAcpAdapter,
  {
    displayName: string
    nativeBinary: string
    acpCommand: string
    acpPackageSpec: string
    acpPackageName: string
    acpBin: string
  }
>

export function isHostAcpAdapter(value: string): value is HostAcpAdapter {
  return value === 'claude' || value === 'codex'
}
