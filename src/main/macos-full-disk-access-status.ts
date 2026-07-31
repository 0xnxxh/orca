import { closeSync, openSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'
import type { DeveloperPermissionStatus } from '../shared/developer-permissions-types'

type ReadProbe = (filePath: string) => void

function openForRead(filePath: string): void {
  const descriptor = openSync(filePath, 'r')
  closeSync(descriptor)
}

function errorCode(error: unknown): string | undefined {
  return error instanceof Error && 'code' in error
    ? (error as NodeJS.ErrnoException).code
    : undefined
}

export function probeMacosFullDiskAccess({
  homeDirectory = homedir(),
  readProbe = openForRead
}: {
  homeDirectory?: string
  readProbe?: ReadProbe
} = {}): DeveloperPermissionStatus {
  const databasePath = join(
    homeDirectory,
    'Library',
    'Application Support',
    'com.apple.TCC',
    'TCC.db'
  )
  try {
    readProbe(databasePath)
    return 'granted'
  } catch (error) {
    const code = errorCode(error)
    return code === 'EACCES' || code === 'EPERM' ? 'denied' : 'unknown'
  }
}

export function getMacosFullDiskAccessStatus(): DeveloperPermissionStatus {
  return process.platform === 'darwin' ? probeMacosFullDiskAccess() : 'unsupported'
}
