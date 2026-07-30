import { describe, expect, it, vi } from 'vitest'

const agentHookMocks = vi.hoisted(() => ({
  agentHookServer: { start: vi.fn(), stop: vi.fn() },
  createHookProviderSessionInvalidator: vi.fn(),
  isAgentStatusHooksEnabled: vi.fn(),
  MANAGED_AGENT_HOOK_INSTALLERS: [['codex', vi.fn()]] as const,
  maybeAutoRenameBranchOnFirstWork: vi.fn(),
  rememberBranchRenameFailureOutput: vi.fn(),
  removeManagedAgentHooks: vi.fn(),
  renameWorktreeFolderOnFirstWork: vi.fn(),
  runManagedHookInstallers: vi.fn(),
  setMigrationUnsupportedPtyListener: vi.fn(),
  wslHookRelayManager: { disposeAll: vi.fn() }
}))

vi.mock('../agent-hooks/branch-rename-failure-output', () => ({
  rememberBranchRenameFailureOutput: agentHookMocks.rememberBranchRenameFailureOutput
}))
vi.mock('../agent-hooks/first-work-branch-rename', () => ({
  maybeAutoRenameBranchOnFirstWork: agentHookMocks.maybeAutoRenameBranchOnFirstWork
}))
vi.mock('../agent-hooks/first-work-folder-rename', () => ({
  renameWorktreeFolderOnFirstWork: agentHookMocks.renameWorktreeFolderOnFirstWork
}))
vi.mock('../agent-hooks/hook-provider-session-invalidation', () => ({
  createHookProviderSessionInvalidator: agentHookMocks.createHookProviderSessionInvalidator
}))
vi.mock('../agent-hooks/install-telemetry', () => ({
  runManagedHookInstallers: agentHookMocks.runManagedHookInstallers
}))
vi.mock('../agent-hooks/managed-agent-hook-controls', () => ({
  isAgentStatusHooksEnabled: agentHookMocks.isAgentStatusHooksEnabled,
  MANAGED_AGENT_HOOK_INSTALLERS: agentHookMocks.MANAGED_AGENT_HOOK_INSTALLERS,
  removeManagedAgentHooks: agentHookMocks.removeManagedAgentHooks
}))
vi.mock('../agent-hooks/migration-unsupported-pty-state', () => ({
  setMigrationUnsupportedPtyListener: agentHookMocks.setMigrationUnsupportedPtyListener
}))
vi.mock('../agent-hooks/server', () => ({
  agentHookServer: agentHookMocks.agentHookServer
}))
vi.mock('../agent-hooks/wsl-hook-relay-manager', () => ({
  wslHookRelayManager: agentHookMocks.wslHookRelayManager
}))

import { createAgentHookRuntimeStartupCapability } from './agent-hook-runtime-startup-capability'

describe('agent-hook runtime startup capability', () => {
  it('returns every original singleton, function, and constant identity', () => {
    expect(createAgentHookRuntimeStartupCapability()).toEqual(agentHookMocks)
  })
})
