import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { existsSync } from 'node:fs'

const ORCA_USER_DATA_PATH_ENV = 'ORCA_USER_DATA_PATH'
export const SHELL_READY_MARKER = '\\033]777;orca-shell-ready\\007'

export function getShellReadyWrapperRoot(): string {
  const userDataPath = process.env[ORCA_USER_DATA_PATH_ENV]
  // Why: older/test launchers may not seed ORCA_USER_DATA_PATH. Keep a
  // fallback so daemon startup does not fail before the parent can be fixed.
  return join(userDataPath || tmpdir(), userDataPath ? 'shell-ready' : 'orca-shell-ready')
}

function getRequiredShellReadyWrapperPaths(root = getShellReadyWrapperRoot()): string[] {
  return [
    join(root, 'zsh', '.zshenv'),
    join(root, 'zsh', '.zprofile'),
    join(root, 'zsh', '.zshrc'),
    join(root, 'zsh', '.zlogin'),
    join(root, 'bash', 'rcfile')
  ]
}

export function shellReadyWrappersExist(): boolean {
  return getRequiredShellReadyWrapperPaths().every((path) => existsSync(path))
}
