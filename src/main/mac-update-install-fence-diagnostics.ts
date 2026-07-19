import { existsSync, lstatSync, readFileSync, readdirSync, rmSync } from 'node:fs'
import { basename, join } from 'node:path'
import { writeSecureFile } from '../shared/secure-file'
import { getMacUpdateFencePaths, withMacUpdateFenceLock } from './mac-update-install-fence-storage'

const DIAGNOSTIC_LIMIT = 32
const DIAGNOSTIC_MAX_BYTES = 64 * 1024
const DIAGNOSTIC_DETAIL_LIMIT = 8
const DIAGNOSTIC_KEY_MAX_LENGTH = 80
const DIAGNOSTIC_STRING_MAX_LENGTH = 128

type MacUpdateFenceDiagnosticValue = string | number | boolean | null

export type MacUpdateFenceDiagnosticRecord = {
  event: string
  at: number
  [key: string]: MacUpdateFenceDiagnosticValue
}

export function writeMacUpdateFenceDiagnostic(
  event: string,
  details: Record<string, MacUpdateFenceDiagnosticValue> = {},
  paths = getMacUpdateFencePaths()
): void {
  try {
    withMacUpdateFenceLock(paths, () => {
      cleanupDiagnosticTemporaryFiles(paths)
      const existing = readDiagnosticRecords(paths.diagnosticPath)
      const next = [...existing, createDiagnosticRecord(event, details)].slice(-DIAGNOSTIC_LIMIT)
      writeSecureFile(paths.diagnosticPath, `${JSON.stringify(next)}\n`)
    })
  } catch {
    // Diagnostics must never influence an install or launch decision.
  }
}

export function consumeMacUpdateFenceDiagnostics(
  paths = getMacUpdateFencePaths()
): MacUpdateFenceDiagnosticRecord[] {
  try {
    if (!existsSync(paths.directoryPath)) {
      return []
    }
    return withMacUpdateFenceLock(paths, () => {
      cleanupDiagnosticTemporaryFiles(paths)
      const records = readDiagnosticRecords(paths.diagnosticPath)
      rmSync(paths.diagnosticPath, { force: true })
      return records
    })
  } catch {
    // Why: lifecycle reporting is best-effort and must not make an otherwise
    // successful application startup fail.
    return []
  }
}

function createDiagnosticRecord(
  event: string,
  details: Record<string, MacUpdateFenceDiagnosticValue>
): MacUpdateFenceDiagnosticRecord {
  const record: MacUpdateFenceDiagnosticRecord = {
    event: event.slice(0, DIAGNOSTIC_KEY_MAX_LENGTH),
    at: Date.now()
  }
  for (const [key, value] of Object.entries(details).slice(0, DIAGNOSTIC_DETAIL_LIMIT)) {
    if (
      key === 'event' ||
      key === 'at' ||
      key.length === 0 ||
      key.length > DIAGNOSTIC_KEY_MAX_LENGTH ||
      (typeof value === 'number' && !Number.isFinite(value))
    ) {
      continue
    }
    record[key] = typeof value === 'string' ? value.slice(0, DIAGNOSTIC_STRING_MAX_LENGTH) : value
  }
  return record
}

function readDiagnosticRecords(path: string): MacUpdateFenceDiagnosticRecord[] {
  try {
    const stats = lstatSync(path)
    if (!stats.isFile() || stats.isSymbolicLink() || stats.size > DIAGNOSTIC_MAX_BYTES) {
      return []
    }
    const value: unknown = JSON.parse(readFileSync(path, 'utf8'))
    return Array.isArray(value)
      ? value
          .slice(-DIAGNOSTIC_LIMIT)
          .filter((record): record is MacUpdateFenceDiagnosticRecord => isDiagnosticRecord(record))
      : []
  } catch {
    return []
  }
}

function isDiagnosticRecord(value: unknown): value is MacUpdateFenceDiagnosticRecord {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    return false
  }
  const record = value as Record<string, unknown>
  if (
    typeof record.event !== 'string' ||
    record.event.length === 0 ||
    record.event.length > DIAGNOSTIC_KEY_MAX_LENGTH ||
    !Number.isSafeInteger(record.at) ||
    (record.at as number) <= 0
  ) {
    return false
  }
  const entries = Object.entries(value)
  if (entries.length > DIAGNOSTIC_DETAIL_LIMIT + 2) {
    return false
  }
  return entries.every(([key, item]) => {
    if (key.length === 0 || key.length > DIAGNOSTIC_KEY_MAX_LENGTH) {
      return false
    }
    if (key === 'event') {
      return typeof item === 'string' && item.length > 0 && item.length <= DIAGNOSTIC_KEY_MAX_LENGTH
    }
    if (key === 'at') {
      return Number.isSafeInteger(item) && (item as number) > 0
    }
    return (
      item === null ||
      typeof item === 'boolean' ||
      (typeof item === 'number' && Number.isFinite(item)) ||
      (typeof item === 'string' && item.length <= DIAGNOSTIC_STRING_MAX_LENGTH)
    )
  })
}

function cleanupDiagnosticTemporaryFiles(paths: ReturnType<typeof getMacUpdateFencePaths>): void {
  const prefix = `${basename(paths.diagnosticPath)}.`
  for (const name of readdirSync(paths.directoryPath).slice(0, 256)) {
    if (name.startsWith(prefix) && name.endsWith('.tmp')) {
      rmSync(join(paths.directoryPath, name), { force: true })
    }
  }
}
