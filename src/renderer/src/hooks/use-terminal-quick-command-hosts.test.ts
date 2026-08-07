import { describe, expect, it } from 'vitest'
import { getDefaultSettings } from '../../../shared/constants'
import {
  flattenTerminalQuickCommandHosts,
  getTerminalQuickCommandHostOptions
} from './use-terminal-quick-command-hosts'

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
