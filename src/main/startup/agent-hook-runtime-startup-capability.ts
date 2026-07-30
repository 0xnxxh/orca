import { rememberBranchRenameFailureOutput } from '../agent-hooks/branch-rename-failure-output'
import { maybeAutoRenameBranchOnFirstWork } from '../agent-hooks/first-work-branch-rename'
import { renameWorktreeFolderOnFirstWork } from '../agent-hooks/first-work-folder-rename'
import { createHookProviderSessionInvalidator } from '../agent-hooks/hook-provider-session-invalidation'
import { runManagedHookInstallers } from '../agent-hooks/install-telemetry'
import {
  isAgentStatusHooksEnabled,
  MANAGED_AGENT_HOOK_INSTALLERS,
  removeManagedAgentHooks
} from '../agent-hooks/managed-agent-hook-controls'
import { setMigrationUnsupportedPtyListener } from '../agent-hooks/migration-unsupported-pty-state'
import { agentHookServer } from '../agent-hooks/server'
import { wslHookRelayManager } from '../agent-hooks/wsl-hook-relay-manager'

export type { AgentHookProviderSessionIdentity } from '../agent-hooks/server'

export type AgentHookRuntimeStartupCapability = {
  agentHookServer: typeof agentHookServer
  createHookProviderSessionInvalidator: typeof createHookProviderSessionInvalidator
  isAgentStatusHooksEnabled: typeof isAgentStatusHooksEnabled
  MANAGED_AGENT_HOOK_INSTALLERS: typeof MANAGED_AGENT_HOOK_INSTALLERS
  maybeAutoRenameBranchOnFirstWork: typeof maybeAutoRenameBranchOnFirstWork
  rememberBranchRenameFailureOutput: typeof rememberBranchRenameFailureOutput
  removeManagedAgentHooks: typeof removeManagedAgentHooks
  renameWorktreeFolderOnFirstWork: typeof renameWorktreeFolderOnFirstWork
  runManagedHookInstallers: typeof runManagedHookInstallers
  setMigrationUnsupportedPtyListener: typeof setMigrationUnsupportedPtyListener
  wslHookRelayManager: typeof wslHookRelayManager
}

export function createAgentHookRuntimeStartupCapability(): AgentHookRuntimeStartupCapability {
  return {
    agentHookServer,
    createHookProviderSessionInvalidator,
    isAgentStatusHooksEnabled,
    MANAGED_AGENT_HOOK_INSTALLERS,
    maybeAutoRenameBranchOnFirstWork,
    rememberBranchRenameFailureOutput,
    removeManagedAgentHooks,
    renameWorktreeFolderOnFirstWork,
    runManagedHookInstallers,
    setMigrationUnsupportedPtyListener,
    wslHookRelayManager
  }
}
