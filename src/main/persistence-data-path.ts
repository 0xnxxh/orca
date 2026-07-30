import { app } from 'electron'
import { copyFileSync, existsSync, mkdirSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { hardenExistingSecureFile } from '../shared/secure-file'
import { MOBILE_PAIRING_USERDATA_FILES } from './runtime/mobile-pairing-files'

let dataFile: string | null = null
let userDataDir: string | null = null

// Why: capture after dev redirection but before app.setName changes path casing on case-sensitive filesystems.
export function initDataPath(): void {
  userDataDir = app.getPath('userData')
  dataFile = join(userDataDir, 'orca-data.json')
}

export function getPersistenceDataFilePath(): string {
  if (!dataFile) {
    userDataDir = app.getPath('userData')
    dataFile = join(userDataDir, 'orca-data.json')
  }
  return dataFile
}

export function getCanonicalUserDataPath(): string {
  userDataDir ??= app.getPath('userData')
  return userDataDir
}

export function migrateMobilePairingDataToCanonicalUserDataPath(sourceUserDataDir: string): void {
  const targetUserDataDir = getCanonicalUserDataPath()
  if (resolve(sourceUserDataDir) === resolve(targetUserDataDir)) {
    return
  }

  const migrations = MOBILE_PAIRING_USERDATA_FILES.map((fileName) => ({
    sourcePath: join(sourceUserDataDir, fileName),
    targetPath: join(targetUserDataDir, fileName)
  }))
  if (
    migrations.some(({ sourcePath }) => !existsSync(sourcePath)) ||
    migrations.some(({ targetPath }) => existsSync(targetPath))
  ) {
    return
  }

  mkdirSync(targetUserDataDir, { recursive: true })
  for (const { sourcePath, targetPath } of migrations) {
    copyFileSync(sourcePath, targetPath)
    // Why: copied credentials must be current-user-only on every platform, including Windows ACLs.
    hardenExistingSecureFile(targetPath)
  }
}
