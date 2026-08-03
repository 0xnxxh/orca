import { getRemoteRuntimePtyEnvironmentId } from '@/runtime/runtime-terminal-stream'
import type { Repo, Worktree } from '../../../../shared/types'
import { parseAppSshPtyId } from '../../../../shared/ssh-pty-id'
import type {
  DashboardCardHostKind,
  DashboardCardTerminalInput
} from '../../../../shared/dashboard-snapshot'

export function chatHostKind(
  repo: Repo,
  worktree: Worktree,
  ptyId: string | null,
  terminalInput: DashboardCardTerminalInput | null | undefined,
  clientPlatform: NodeJS.Platform
): DashboardCardHostKind {
  const executionHostId = worktree.hostId ?? repo.executionHostId
  if (repo.connectionId || executionHostId?.startsWith('ssh:')) {
    return 'ssh'
  }
  if (executionHostId && executionHostId !== 'local') {
    return 'remote'
  }
  if (ptyId && parseAppSshPtyId(ptyId)) {
    return 'ssh'
  }
  if (ptyId && getRemoteRuntimePtyEnvironmentId(ptyId)) {
    return 'remote'
  }
  return clientPlatform === 'win32' && terminalInput?.hostPlatform === 'linux' ? 'wsl' : 'local'
}
