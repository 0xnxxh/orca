import { beforeEach, describe, expect, it, vi } from 'vitest'

// Why: install/remove per agent used to be one uninterruptible sync block. Now
// that both await real fs, an overlapping startup install and Settings toggle
// could interleave their read-modify-write of the same hooks.json.
const mocks = vi.hoisted(() => ({
  detect: vi.fn(),
  order: [] as string[],
  installClaude: vi.fn(),
  removeClaude: vi.fn()
}))

vi.mock('./local-agent-cli-presence', () => ({
  detectLocalManagedAgentCliPresence: mocks.detect
}))

vi.mock('./managed-agent-hook-registry', () => ({
  MANAGED_AGENT_HOOK_INSTALLERS: [['claude', mocks.installClaude]],
  MANAGED_AGENT_HOOK_REMOVERS: [['claude', mocks.removeClaude]],
  MANAGED_AGENT_HOOK_STATUS_READERS: [['claude', vi.fn()]]
}))

import { applyAgentStatusHooksEnabled } from './managed-agent-hook-controls'

function status(state: 'installed' | 'not_installed') {
  return {
    agent: 'claude',
    state,
    configPath: '/claude',
    managedHooksPresent: state === 'installed',
    detail: null
  } as const
}

// Why: an install that yields mid-flight is exactly what a real fs write does.
function tick(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, 0))
}

describe('managed hook mutations never interleave', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.order = []
    mocks.detect.mockImplementation(async () => {
      await tick()
      return { claude: { state: 'found' } }
    })
    mocks.installClaude.mockImplementation(async () => {
      mocks.order.push('install:start')
      await tick()
      await tick()
      mocks.order.push('install:end')
      return status('installed')
    })
    mocks.removeClaude.mockImplementation(async () => {
      mocks.order.push('remove:start')
      await tick()
      mocks.order.push('remove:end')
      return status('not_installed')
    })
  })

  it('runs a concurrent disable after the in-flight install finishes', async () => {
    const install = applyAgentStatusHooksEnabled(true, { agentCmdOverrides: {} })
    const disable = applyAgentStatusHooksEnabled(false)

    await Promise.all([install, disable])

    expect(mocks.order).toEqual(['install:start', 'install:end', 'remove:start', 'remove:end'])
  })

  it('keeps queued mutations running after an earlier one rejects', async () => {
    mocks.installClaude.mockRejectedValueOnce(new Error('write failed'))

    const install = applyAgentStatusHooksEnabled(true, { agentCmdOverrides: {} })
    const disable = applyAgentStatusHooksEnabled(false)

    const [installed, removed] = await Promise.all([install, disable])

    expect(installed[0]?.state).toBe('error')
    expect(removed[0]?.state).toBe('not_installed')
    expect(mocks.order).toEqual(['remove:start', 'remove:end'])
  })
})
