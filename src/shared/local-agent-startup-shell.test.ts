import { describe, expect, it } from 'vitest'
import { resolveLocalAgentStartupShell } from './local-agent-startup-shell'
import { buildAgentDraftLaunchPlan } from './tui-agent-startup'

const posixHost = {
  platform: 'darwin' as NodeJS.Platform,
  hostPlatform: 'darwin' as NodeJS.Platform,
  isRemote: false,
  executionHostKind: 'local' as const
}

describe('resolveLocalAgentStartupShell', () => {
  it('adopts the fish dialect when this machine parses the line', () => {
    expect(
      resolveLocalAgentStartupShell({ ...posixHost, hostLoginShell: '/opt/homebrew/bin/fish' })
    ).toBe('fish')
  })

  it('stays posix for sh-family login shells', () => {
    expect(resolveLocalAgentStartupShell({ ...posixHost, hostLoginShell: '/bin/zsh' })).toBe(
      'posix'
    )
    expect(resolveLocalAgentStartupShell({ ...posixHost, hostLoginShell: '' })).toBe('posix')
    expect(resolveLocalAgentStartupShell({ ...posixHost, hostLoginShell: undefined })).toBe('posix')
  })

  // Why each of these matters: `set -e VAR` in bash enables errexit instead of
  // clearing anything, so a wrong dialect is worse than the sh default.
  it('refuses the local dialect for a remote target', () => {
    expect(
      resolveLocalAgentStartupShell({
        ...posixHost,
        isRemote: true,
        hostLoginShell: '/usr/bin/fish'
      })
    ).toBeUndefined()
  })

  it('refuses the local dialect for ssh and runtime execution hosts', () => {
    for (const executionHostKind of ['ssh', 'runtime'] as const) {
      expect(
        resolveLocalAgentStartupShell({
          ...posixHost,
          executionHostKind,
          hostLoginShell: '/usr/bin/fish'
        })
      ).toBeUndefined()
    }
  })

  it('refuses the local dialect when the target platform is not this one (WSL)', () => {
    expect(
      resolveLocalAgentStartupShell({
        ...posixHost,
        platform: 'linux',
        hostPlatform: 'win32',
        hostLoginShell: '/usr/bin/fish'
      })
    ).toBeUndefined()
  })

  it('keeps the Windows shell families untouched', () => {
    expect(
      resolveLocalAgentStartupShell({
        platform: 'win32',
        hostPlatform: 'win32',
        isRemote: false,
        executionHostKind: 'local',
        hostLoginShell: '/usr/bin/fish',
        terminalWindowsShell: 'cmd.exe'
      })
    ).toBe('cmd')
  })

  it('reaches the fish draft-prefill teardown end to end', () => {
    const shell = resolveLocalAgentStartupShell({
      ...posixHost,
      hostLoginShell: '/opt/homebrew/bin/fish'
    })
    const plan = buildAgentDraftLaunchPlan({
      agent: 'pi',
      draft: 'hello',
      cmdOverrides: {},
      platform: 'darwin',
      shell
    })

    expect(plan?.launchCommand).toBe('pi; set -e ORCA_PI_PREFILL')
  })
})
