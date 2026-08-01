import { existsSync } from 'node:fs'
import { win32 } from 'node:path'

function systemSshPaths(platform: NodeJS.Platform): string[] {
  return platform === 'win32'
    ? ['C:\\Windows\\System32\\OpenSSH\\ssh.exe']
    : ['/usr/bin/ssh', '/usr/local/bin/ssh', '/opt/homebrew/bin/ssh']
}

function findWindowsSshOnPath(): string | null {
  const pathValue = process.env.PATH
  if (!pathValue) {
    return null
  }
  for (const entry of pathValue.split(win32.delimiter)) {
    const directory = entry.trim().replace(/^"|"$/g, '')
    if (!directory) {
      continue
    }
    const candidate = win32.join(directory, 'ssh.exe')
    if (existsSync(candidate)) {
      return candidate
    }
  }
  return null
}

/**
 * Find the system ssh binary path. Returns null if not found.
 */
export function findSystemSsh(): string | null {
  if (process.env.ORCA_SYSTEM_SSH_PATH) {
    return process.env.ORCA_SYSTEM_SSH_PATH
  }
  for (const candidate of systemSshPaths(process.platform)) {
    if (existsSync(candidate)) {
      return candidate
    }
  }
  return process.platform === 'win32' ? findWindowsSshOnPath() : null
}
