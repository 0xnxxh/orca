import type { AppState } from '@/store/types'
import { getRemoteRuntimePtyEnvironmentId } from '@/runtime/runtime-terminal-stream'
import type { DashboardCard, DashboardCardHostKind } from '../../../../shared/dashboard-snapshot'
import { parseAppSshPtyId } from '../../../../shared/ssh-pty-id'

export function dashboardCardHostKind(
  repo: AppState['repos'][number],
  worktree: AppState['worktreesByRepo'][string][number],
  ptyId: string | null,
  terminalInput: DashboardCard['terminalInput'],
  clientPlatform: NodeJS.Platform
): DashboardCardHostKind {
  const executionHostId = worktree.hostId ?? repo.executionHostId
  if (
    repo.connectionId ||
    executionHostId?.startsWith('ssh:') ||
    (ptyId && parseAppSshPtyId(ptyId))
  ) {
    return 'ssh'
  }
  if (
    (executionHostId && executionHostId !== 'local') ||
    (ptyId && getRemoteRuntimePtyEnvironmentId(ptyId))
  ) {
    return 'remote'
  }
  return clientPlatform === 'win32' && terminalInput?.hostPlatform === 'linux' ? 'wsl' : 'local'
}
