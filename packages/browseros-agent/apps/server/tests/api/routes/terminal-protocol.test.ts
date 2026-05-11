/**
 * @license
 * Copyright 2025 BrowserOS
 */

import { describe, expect, it } from 'bun:test'
import { CLAUDE_CONTAINER_NAME } from '@browseros/shared/constants/claude'
import { OPENCLAW_GATEWAY_CONTAINER_NAME } from '@browseros/shared/constants/openclaw'
import {
  parseTerminalClientMessage,
  serializeTerminalServerMessage,
} from '../../../src/api/services/terminal/terminal-protocol'
import {
  buildTerminalEnv,
  buildTerminalExecCommand,
  listTerminalTargets,
  resolveTerminalTarget,
} from '../../../src/api/services/terminal/terminal-session'

describe('terminal protocol', () => {
  it('parses input messages', () => {
    expect(
      parseTerminalClientMessage('{"type":"input","data":"ls\\n"}'),
    ).toEqual({
      type: 'input',
      data: 'ls\n',
    })
  })

  it('parses resize messages', () => {
    expect(
      parseTerminalClientMessage('{"type":"resize","cols":120,"rows":40}'),
    ).toEqual({
      type: 'resize',
      cols: 120,
      rows: 40,
    })
  })

  it('returns null for malformed or invalid client messages', () => {
    expect(parseTerminalClientMessage('not-json')).toBeNull()
    expect(
      parseTerminalClientMessage('{"type":"resize","cols":0,"rows":40}'),
    ).toBeNull()
    expect(
      parseTerminalClientMessage(new Blob(['{"type":"input","data":"ls"}'])),
    ).toBeNull()
  })

  it('serializes server messages', () => {
    expect(
      serializeTerminalServerMessage({ type: 'output', data: 'hello' }),
    ).toBe('{"type":"output","data":"hello"}')
  })

  it('builds a limactl shell command rooted in the container home dir', () => {
    expect(
      buildTerminalExecCommand(
        'limactl',
        'browseros-vm',
        resolveTerminalTarget({
          browserosDir: '/tmp/browseros',
          target: 'openclaw',
        }),
      ),
    ).toEqual([
      'limactl',
      'shell',
      'browseros-vm',
      '--',
      'nerdctl',
      'exec',
      '-it',
      '-w',
      '/home/node/.openclaw',
      OPENCLAW_GATEWAY_CONTAINER_NAME,
      '/bin/sh',
    ])
  })

  it('builds a Claude terminal command with the selected agent home', () => {
    const target = resolveTerminalTarget({
      browserosDir: '/tmp/browseros',
      target: 'claude',
      agentId: 'agent-1',
    })

    const agentHome = '/tmp/browseros/vm/claude/harness/agent-1/home'
    expect(target).toMatchObject({
      id: 'claude',
      containerName: CLAUDE_CONTAINER_NAME,
      workingDir: agentHome,
      env: {
        AGENT_HOME: agentHome,
        HOME: agentHome,
      },
    })
    expect(buildTerminalExecCommand('limactl', 'browseros-vm', target)).toEqual(
      [
        'limactl',
        'shell',
        'browseros-vm',
        '--',
        'nerdctl',
        'exec',
        '-it',
        '-e',
        `AGENT_HOME=${agentHome}`,
        '-e',
        `HOME=${agentHome}`,
        '-w',
        agentHome,
        CLAUDE_CONTAINER_NAME,
        '/bin/sh',
      ],
    )
  })

  it('lists only running managed terminal targets for an agent', () => {
    expect(
      listTerminalTargets({
        browserosDir: '/tmp/browseros',
        agentId: 'agent-1',
        runningContainers: new Set([CLAUDE_CONTAINER_NAME]),
      }),
    ).toEqual([
      expect.objectContaining({
        id: 'claude',
        label: 'Claude Code runtime',
        containerName: CLAUDE_CONTAINER_NAME,
        running: true,
      }),
    ])
  })

  it('sets LIMA_HOME for terminal limactl sessions', () => {
    expect(buildTerminalEnv('/tmp/browseros-lima')).toEqual(
      expect.objectContaining({
        LIMA_HOME: '/tmp/browseros-lima',
        TERM: 'xterm-256color',
      }),
    )
  })
})
