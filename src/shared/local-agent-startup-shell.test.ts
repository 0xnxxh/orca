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

  it('uses the portable Unix dialect for a remote target', () => {
    expect(
      resolveLocalAgentStartupShell({
        ...posixHost,
        isRemote: true,
        hostLoginShell: '/usr/bin/fish'
      })
    ).toBe('unix')
  })

  it('uses the portable Unix dialect for ssh and runtime execution hosts', () => {
    for (const executionHostKind of ['ssh', 'runtime'] as const) {
      expect(
        resolveLocalAgentStartupShell({
          ...posixHost,
          executionHostKind,
          hostLoginShell: '/usr/bin/fish'
        })
      ).toBe('unix')
    }
  })

  it('uses the portable Unix dialect when the target platform is not this one (WSL)', () => {
    expect(
      resolveLocalAgentStartupShell({
        ...posixHost,
        platform: 'linux',
        hostPlatform: 'win32',
        hostLoginShell: '/usr/bin/fish'
      })
    ).toBe('unix')
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

  it('lets an agent bash override replace a fish login-shell dialect', () => {
    const plan = buildAgentDraftLaunchPlan({
      agent: 'pi',
      draft: 'hello',
      cmdOverrides: {},
      platform: 'darwin',
      shell: 'fish',
      agentEnv: { SHELL: '/bin/bash' }
    })

    expect(plan?.launchCommand).toBe('pi; unset ORCA_PI_PREFILL')
  })

  it('lets an agent fish override replace a sh-family login-shell dialect', () => {
    const plan = buildAgentDraftLaunchPlan({
      agent: 'pi',
      draft: 'hello',
      cmdOverrides: {},
      platform: 'linux',
      shell: 'posix',
      agentEnv: { SHELL: '/usr/bin/fish' }
    })

    expect(plan?.launchCommand).toBe('pi; set -e ORCA_PI_PREFILL')
  })
})
