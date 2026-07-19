import { mkdirSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'
import {
  CODEX_GLOBAL_INSTRUCTIONS_ENTRY,
  linkSystemCodexResource
} from './codex-home-resource-link'

const CODEX_SYSTEM_RESOURCE_ENTRIES = [
  'skills',
  'hooks',
  'plugins',
  'plugin-state',
  'profile-v2',
  'themes',
  'prompts',
  CODEX_GLOBAL_INSTRUCTIONS_ENTRY
] as const

export function getSystemCodexHomePath(): string {
  return join(homedir(), '.codex')
}

export function getOrcaManagedCodexHomePath(): string {
  const managedHomePath = join(getOrcaUserDataPath(), 'codex-runtime-home', 'home')
  mkdirSync(managedHomePath, { recursive: true })
  return managedHomePath
}

export function getCodexSessionBackfillStateDirPath(): string {
  return join(getOrcaUserDataPath(), 'codex-session-backfill')
}

function getOrcaUserDataPath(): string {
  if (process.env.ORCA_USER_DATA_PATH) {
    return process.env.ORCA_USER_DATA_PATH
  }
  // Why: CLI hook commands import this module outside Electron. Mirror the CLI
  // runtime metadata path so offline hook status/on/off uses the same userData.
  if (process.platform === 'darwin') {
    return join(homedir(), 'Library', 'Application Support', 'orca')
  }
  if (process.platform === 'win32') {
    return join(process.env.APPDATA ?? join(homedir(), 'AppData', 'Roaming'), 'orca')
  }
  return join(process.env.XDG_CONFIG_HOME || join(homedir(), '.config'), 'orca')
}

// Why: each managed home (the shared runtime mirror, or a per-account
// self-contained CODEX_HOME that the caller has already created) links the same
// system resources with its own ownership markers, so a per-account launch home
// is complete without ever symlinking into or mutating the user's real ~/.codex.
export function syncSystemCodexResourcesIntoManagedHome(managedHomePath?: string): void {
  const targetHome = managedHomePath ?? getOrcaManagedCodexHomePath()
  const systemHomePath = getSystemCodexHomePath()
  for (const entryName of CODEX_SYSTEM_RESOURCE_ENTRIES) {
    linkSystemCodexResource(systemHomePath, targetHome, entryName)
  }
}

export function syncCodexGlobalInstructionsIntoManagedHome({
  systemHomePath,
  managedHomePath
}: {
  systemHomePath: string
  managedHomePath: string
}): void {
  mkdirSync(managedHomePath, { recursive: true })
  // Why: this only runs for WSL runtime homes, whose system + managed homes are
  // both \\wsl.localhost UNC paths. A host-side symlink there stores a Windows
  // UNC target the distro cannot resolve, so copy the file like the config
  // mirror does across the same boundary.
  linkSystemCodexResource(systemHomePath, managedHomePath, CODEX_GLOBAL_INSTRUCTIONS_ENTRY, {
    preferCopy: true
  })
}
