import { Buffer } from 'node:buffer'
import { readFile, stat } from 'node:fs/promises'
import path from 'node:path'
import {
  assertAuthorityNamespace,
  isRecord,
  type TerminalAuthorityNamespace
} from '../../shared/terminal-session-authority-identity'
import {
  failTerminalSessionAuthority,
  type TerminalSessionAuthorityLogRecord,
  type TerminalSessionAuthoritySnapshot
} from '../../shared/terminal-session-authority-mutation'
import { assertSafeInteger } from '../../shared/terminal-session-authority-record-validation'
import { assertTerminalSessionAuthoritySnapshotEnvelope } from '../../shared/terminal-session-authority-snapshot'

export const TERMINAL_AUTHORITY_CHECKPOINT_FILE = 'authority.checkpoint.json'
export const TERMINAL_AUTHORITY_LOG_FILE = 'authority.log'

export type TerminalAuthorityCheckpoint = Readonly<{
  version: 1
  namespace: TerminalAuthorityNamespace
  throughRecordId: number
  snapshot: TerminalSessionAuthoritySnapshot
}>

export type TerminalAuthorityLoadedLog = Readonly<{
  records: TerminalSessionAuthorityLogRecord[]
  completeBytes: number
  truncateToBytes: number | null
}>

export async function readTerminalAuthorityRecordFiles(
  directory: string,
  namespace: TerminalAuthorityNamespace,
  maxCheckpointBytes: number,
  maxLogBytes: number
): Promise<
  Readonly<{
    checkpoint: TerminalAuthorityCheckpoint | null
    log: TerminalAuthorityLoadedLog
  }>
> {
  const checkpoint = await readCheckpoint(directory, namespace, maxCheckpointBytes)
  const log = await readLog(
    directory,
    checkpoint?.throughRecordId ?? 0,
    checkpoint?.snapshot.writerEpoch ?? 0,
    maxLogBytes
  )
  return Object.freeze({ checkpoint, log })
}

export async function terminalAuthorityRecordFilesContainLegacyMigrations(
  directory: string,
  namespace: TerminalAuthorityNamespace,
  maxCheckpointBytes: number,
  maxLogBytes: number
): Promise<boolean> {
  const loaded = await readTerminalAuthorityRecordFiles(
    directory,
    namespace,
    maxCheckpointBytes,
    maxLogBytes
  )
  return (
    (loaded.checkpoint?.snapshot.legacyMigrations.length ?? 0) > 0 ||
    loaded.log.records.some((record) => record.event.kind === 'legacy-migration')
  )
}

async function readCheckpoint(
  directory: string,
  namespace: TerminalAuthorityNamespace,
  maxBytes: number
): Promise<TerminalAuthorityCheckpoint | null> {
  const checkpointPath = path.join(directory, TERMINAL_AUTHORITY_CHECKPOINT_FILE)
  const contents = await readBoundedFile(checkpointPath, maxBytes)
  if (contents === null) {
    return null
  }
  const value = JSON.parse(contents) as unknown
  if (!isRecord(value) || value.version !== 1) {
    failTerminalSessionAuthority('record-corrupt', 'authority checkpoint version is invalid')
  }
  assertAuthorityNamespace(value.namespace)
  assertSafeInteger(value.throughRecordId, 'checkpoint record ID')
  assertTerminalSessionAuthoritySnapshotEnvelope(value.snapshot)
  const snapshot = value.snapshot
  assertAuthorityNamespace(snapshot.namespace)
  assertSafeInteger(snapshot.writerEpoch, 'snapshot writer epoch', 1)
  if (
    value.namespace.authorityHostId !== namespace.authorityHostId ||
    value.namespace.namespaceId !== namespace.namespaceId ||
    snapshot.namespace.authorityHostId !== namespace.authorityHostId ||
    snapshot.namespace.namespaceId !== namespace.namespaceId
  ) {
    failTerminalSessionAuthority('record-corrupt', 'authority checkpoint namespace changed')
  }
  return Object.freeze({
    version: 1,
    namespace: value.namespace,
    throughRecordId: value.throughRecordId,
    snapshot
  })
}

async function readLog(
  directory: string,
  throughRecordId: number,
  checkpointWriterEpoch: number,
  maxBytes: number
): Promise<TerminalAuthorityLoadedLog> {
  const contents = await readBoundedFile(
    path.join(directory, TERMINAL_AUTHORITY_LOG_FILE),
    maxBytes
  )
  if (contents === null || contents.length === 0) {
    return Object.freeze({ records: [], completeBytes: 0, truncateToBytes: null })
  }
  const complete = contents.endsWith('\n')
    ? contents
    : contents.slice(0, contents.lastIndexOf('\n') + 1)
  const completeBytes = Buffer.byteLength(complete, 'utf8')
  const records: TerminalSessionAuthorityLogRecord[] = []
  let expectedRecordId = throughRecordId + 1
  let previousEpoch = checkpointWriterEpoch
  for (const line of complete.split('\n')) {
    if (!line) {
      continue
    }
    const value = JSON.parse(line) as unknown
    if (!isRecord(value) || value.version !== 1) {
      failTerminalSessionAuthority('record-corrupt', 'authority log record is invalid')
    }
    assertSafeInteger(value.recordId, 'log record ID', 1)
    assertSafeInteger(value.writerEpoch, 'log writer epoch', 1)
    if (value.recordId <= throughRecordId) {
      continue
    }
    if (
      value.recordId !== expectedRecordId ||
      value.writerEpoch < checkpointWriterEpoch ||
      value.writerEpoch < previousEpoch
    ) {
      failTerminalSessionAuthority('record-corrupt', 'authority log is not contiguous')
    }
    records.push(value as TerminalSessionAuthorityLogRecord)
    expectedRecordId += 1
    previousEpoch = value.writerEpoch
  }
  return Object.freeze({
    records,
    completeBytes,
    truncateToBytes: complete.length === contents.length ? null : completeBytes
  })
}

async function readBoundedFile(file: string, maxBytes: number): Promise<string | null> {
  let metadata
  try {
    metadata = await stat(file)
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
      return null
    }
    throw error
  }
  if (!metadata.isFile() || metadata.size > maxBytes) {
    failTerminalSessionAuthority('record-corrupt', 'authority persistence is not a bounded file')
  }
  return readFile(file, 'utf8')
}
