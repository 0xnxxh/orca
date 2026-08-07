// @vitest-environment happy-dom

import { act, createElement } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { getDefaultSettings } from '../../../shared/constants'
import type { ExecutionHostId } from '../../../shared/execution-host'
import type { GlobalSettings } from '../../../shared/types'
import type { RuntimeTerminalQuickCommands } from '@/store/slices/terminal-quick-command-hosts'

const testState = vi.hoisted(() => ({
  executionHostId: 'runtime:build' as ExecutionHostId,
  loadRuntimeTerminalQuickCommands: vi.fn(async () => {}),
  runtimeEnvironments: [] as { id: string; name: string }[],
  runtimeStatusByEnvironmentId: new Map<string, { connectionGeneration?: number }>(),
  runtimeTerminalQuickCommands: new Map<string, RuntimeTerminalQuickCommands>(),
  settings: null as GlobalSettings | null
}))

vi.mock('@/store', () => ({
  useAppStore: (selector: (state: typeof testState) => unknown) => selector(testState)
}))

vi.mock('@/lib/worktree-runtime-owner', () => ({
  getExecutionHostIdForWorktree: () => testState.executionHostId
}))

import {
  flattenTerminalQuickCommandHosts,
  getTerminalQuickCommandHostOptions,
  useTerminalQuickCommandHosts,
  type TerminalQuickCommandHost
} from './use-terminal-quick-command-hosts'

let renderedHosts: TerminalQuickCommandHost[] = []

function Probe(): null {
  renderedHosts = useTerminalQuickCommandHosts('worktree-1').hosts
  return null
}

describe('useTerminalQuickCommandHosts', () => {
  let root: Root

  beforeEach(() => {
    testState.executionHostId = 'runtime:build'
    testState.loadRuntimeTerminalQuickCommands.mockClear()
    testState.runtimeEnvironments = [{ id: 'build', name: 'Build Server' }]
    testState.runtimeStatusByEnvironmentId = new Map([['build', { connectionGeneration: 4 }]])
    testState.runtimeTerminalQuickCommands = new Map()
    testState.settings = getDefaultSettings('/tmp')
    renderedHosts = []
    const container = document.createElement('div')
    document.body.appendChild(container)
    root = createRoot(container)
  })

  afterEach(() => {
    act(() => root.unmount())
    document.body.replaceChildren()
  })

  it.each([
    { name: 'unsupported', supported: false, generation: 4, expected: ['local'] },
    { name: 'stale generation', supported: true, generation: 3, expected: ['local'] },
    {
      name: 'supported current generation',
      supported: true,
      generation: 4,
      expected: ['local', 'runtime:build']
    }
  ])('gates the remote host when it is $name', async ({ supported, generation, expected }) => {
    testState.runtimeTerminalQuickCommands = new Map([
      [
        'build',
        {
          commands: [],
          connectionGeneration: generation,
          error: null,
          loading: false,
          ready: true,
          supported
        }
      ]
    ])

    await act(async () => root.render(createElement(Probe)))

    expect(renderedHosts.map((host) => host.hostId)).toEqual(expected)
    expect(testState.loadRuntimeTerminalQuickCommands).toHaveBeenCalledWith('build')
  })
})

describe('flattenTerminalQuickCommandHosts', () => {
  it('keeps identical command ids distinct by owning host', () => {
    const command = {
      id: 'build',
      label: 'Build',
      action: 'terminal-command' as const,
      command: 'pnpm build',
      appendEnter: true,
      scope: { type: 'global' as const }
    }

    const entries = flattenTerminalQuickCommandHosts([
      { hostId: 'local', label: 'Local Mac', commands: [command] },
      { hostId: 'runtime:server', label: 'Build Server', commands: [command] }
    ])

    expect(entries.map((entry) => [entry.key, entry.hostLabel])).toEqual([
      ['local\0build', 'Local Mac'],
      ['runtime:server\0build', 'Build Server']
    ])
  })

  it('reuses execution-host registry names and rename overrides', () => {
    const settings = {
      ...getDefaultSettings('/tmp'),
      hostSettingOverrides: {
        local: { displayLabel: 'Studio Mac' },
        'runtime:build': { displayLabel: 'Build Server' }
      }
    }

    expect(
      getTerminalQuickCommandHostOptions(settings, [{ id: 'build', name: 'Remote Mac' }])
    ).toEqual([
      { id: 'local', label: 'Studio Mac' },
      { id: 'runtime:build', label: 'Build Server' }
    ])
  })
})
