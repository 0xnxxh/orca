import { beforeEach, describe, expect, it, vi } from 'vitest'

describe('agent-hook runtime startup owner', () => {
  beforeEach(() => {
    vi.resetModules()
  })

  it('fails closed before installation while optional teardown reads null', async () => {
    const {
      getAgentHookRuntimeStartupCapability,
      getAgentHookRuntimeStartupCapabilityIfInstalled
    } = await import('./agent-hook-runtime-startup-owner')

    expect(getAgentHookRuntimeStartupCapabilityIfInstalled()).toBeNull()
    expect(() => getAgentHookRuntimeStartupCapability()).toThrow(
      'Agent-hook runtime capability must be initialized before use'
    )
  })

  it('returns the exact installed capability identity', async () => {
    const {
      getAgentHookRuntimeStartupCapability,
      getAgentHookRuntimeStartupCapabilityIfInstalled,
      installAgentHookRuntimeStartupCapability
    } = await import('./agent-hook-runtime-startup-owner')
    const capability = {
      agentHookServer: {},
      createHookProviderSessionInvalidator: vi.fn(),
      isAgentStatusHooksEnabled: vi.fn(),
      MANAGED_AGENT_HOOK_INSTALLERS: [],
      maybeAutoRenameBranchOnFirstWork: vi.fn(),
      rememberBranchRenameFailureOutput: vi.fn(),
      removeManagedAgentHooks: vi.fn(),
      renameWorktreeFolderOnFirstWork: vi.fn(),
      runManagedHookInstallers: vi.fn(),
      setMigrationUnsupportedPtyListener: vi.fn(),
      wslHookRelayManager: {}
    }

    installAgentHookRuntimeStartupCapability(capability as never)

    expect(getAgentHookRuntimeStartupCapability()).toBe(capability)
    expect(getAgentHookRuntimeStartupCapabilityIfInstalled()).toBe(capability)
  })
})
