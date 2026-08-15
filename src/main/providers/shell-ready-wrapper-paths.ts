/**
 * Where the generated shell-ready wrapper rcfiles live, and which original ZDOTDIR /
 * .zshenv source dir a wrapped zsh must restore.
 */
import { tmpdir } from 'node:os'
import { existsSync } from 'node:fs'

export function getShellReadyWrapperRoot(): string {
  // Why: bundled into the daemon fork (no electron), so read ORCA_USER_DATA_PATH rather than electron's userData; main and the fork both set it to the same path.
  const userDataPath = process.env.ORCA_USER_DATA_PATH ?? tmpdir()
  return `${userDataPath}/shell-ready`
}

function getRequiredShellReadyWrapperPaths(root = getShellReadyWrapperRoot()): string[] {
  return [
    `${root}/zsh/.zshenv`,
    `${root}/zsh/.zprofile`,
    `${root}/zsh/.zshrc`,
    `${root}/zsh/.zlogin`,
    `${root}/bash/rcfile`
  ]
}

export function shellReadyWrappersExist(root = getShellReadyWrapperRoot()): boolean {
  return getRequiredShellReadyWrapperPaths(root).every((path) => existsSync(path))
}

// Why: an Orca wrapper ZDOTDIR recurses; treat it as unset and fall back to HOME.
function normalizeOriginalZdotdirCandidate(value: string | undefined): string | null {
  if (!value) {
    return null
  }
  // Why: strip trailing slashes so wrapper paths match; `/` falls back to HOME.
  const normalized = value.replace(/\/+$/, '')
  if (!normalized || normalized.endsWith('/shell-ready/zsh')) {
    return null
  }
  return value
}

export function resolveOriginalZdotdir(): string {
  return (
    normalizeOriginalZdotdirCandidate(process.env.ZDOTDIR) ||
    normalizeOriginalZdotdirCandidate(process.env.ORCA_ORIG_ZDOTDIR) ||
    process.env.HOME ||
    ''
  )
}

export function resolveOriginalZshenvSourceDir(): string {
  return normalizeOriginalZdotdirCandidate(process.env.ZDOTDIR) || process.env.HOME || ''
}
