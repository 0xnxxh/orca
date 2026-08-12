import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { resolveHostAgentStartupShell } from './host-agent-startup-shell'

// Pinned: the resolver reads process.env.SHELL, which differs per developer machine.
let originalShell: string | undefined

describe('resolveHostAgentStartupShell', () => {
  beforeEach(() => {
    originalShell = process.env.SHELL
  })

  afterEach(() => {
    if (originalShell === undefined) {
      delete process.env.SHELL
    } else {
      process.env.SHELL = originalShell
    }
  })

  it("uses this process's login shell, since it is the one spawning the pty", () => {
    process.env.SHELL = '/opt/homebrew/bin/fish'
    expect(resolveHostAgentStartupShell({ platform: process.platform, isRemote: false })).toBe(
      process.platform === 'win32' ? 'powershell' : 'fish'
    )
  })

  it('stays on the sh default for a remote workspace', () => {
    process.env.SHELL = '/opt/homebrew/bin/fish'
    expect(
      resolveHostAgentStartupShell({ platform: process.platform, isRemote: true })
    ).toBeUndefined()
  })

  it('stays on the sh default when the workspace platform is not this host', () => {
    process.env.SHELL = '/opt/homebrew/bin/fish'
    const otherPlatform = process.platform === 'win32' ? 'linux' : 'win32'
    expect(resolveHostAgentStartupShell({ platform: otherPlatform, isRemote: false })).not.toBe(
      'fish'
    )
  })
})
