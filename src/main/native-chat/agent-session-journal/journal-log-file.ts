// On-disk layout for one session's journal.
//
//   <journal dir>/log.jsonl    append-only rows, fsynced before the caller is told the write landed
//   <journal dir>/snapshot.json  folded state at a compaction boundary PLUS the retained tail
//   <journal dir>/blobs/<sha256> bounded-payload remainders
//
// The snapshot carries its own tail so compaction is one atomic write. A crash
// between publishing the snapshot and truncating the log leaves the log a
// superset of the tail, and recovery unions the two by sequence — never a hole.

import { appendFile, mkdir, open, readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { durableWriteTempPath, writeFileDurable } from '../../durable-file-write'
import type {
  AgentJournalRenderItem,
  AgentJournalSubmission
} from '../../../shared/agent-session-journal-types'
import { AGENT_SESSION_JOURNAL_SCHEMA_VERSION } from '../../../shared/agent-session-journal-types'
import { parseJournalRow, serializeJournalRow, type JournalRow } from './journal-row-schema'

export const JOURNAL_LOG_FILE = 'log.jsonl'
export const JOURNAL_SNAPSHOT_FILE = 'snapshot.json'

export type JournalSnapshotFile = {
  v: number
  epoch: string
  /** Highest sequence folded into `items`; the tail starts after it. */
  compactedThrough: number
  highestFence: number
  items: AgentJournalRenderItem[]
  tombstones: { itemId: string; revision: number }[]
  submissions: AgentJournalSubmission[]
  /** Receipts outlive the rows that minted them: a client reconnecting after
   *  compaction must still get the same answer instead of re-sending. */
  receipts: {
    clientMessageId: string
    providerItemId: string
    epoch: string
    sequence: number
    acceptedAt: number
  }[]
  /** Provider item id → submission slot, preserved so a post-compaction echo
   *  still reconciles into the bubble it belongs to. */
  aliases: { providerItemId: string; itemId: string }[]
  tail: JournalRow[]
}

export type JournalReadResult = {
  rows: JournalRow[]
  /** True when a line used a schema version this build cannot read. Reading
   *  STOPS there — the row must not be skipped — and the host degrades to
   *  read-only: no writes, no compaction, no deletion. */
  unreadable: boolean
  /** Lines that failed to parse for reasons other than schema version. */
  malformed: number
}

export type JournalSnapshotReadResult = {
  snapshot: JournalSnapshotFile | null
  unreadable: boolean
}

export async function ensureJournalDir(journalDir: string): Promise<void> {
  await mkdir(journalDir, { recursive: true })
}

export async function readJournalSnapshotFile(
  journalDir: string
): Promise<JournalSnapshotReadResult> {
  try {
    const raw = await readFile(join(journalDir, JOURNAL_SNAPSHOT_FILE), 'utf-8')
    const parsed = JSON.parse(raw) as Partial<JournalSnapshotFile>
    if (typeof parsed?.v !== 'number' || !Number.isInteger(parsed.v) || parsed.v < 1) {
      return { snapshot: null, unreadable: false }
    }
    if (parsed.v > AGENT_SESSION_JOURNAL_SCHEMA_VERSION) {
      return { snapshot: null, unreadable: true }
    }
    return {
      snapshot: typeof parsed?.epoch === 'string' ? (parsed as JournalSnapshotFile) : null,
      unreadable: false
    }
  } catch {
    return { snapshot: null, unreadable: false }
  }
}

export async function writeJournalSnapshotFile(
  journalDir: string,
  snapshot: JournalSnapshotFile
): Promise<void> {
  const target = join(journalDir, JOURNAL_SNAPSHOT_FILE)
  await writeFileDurable(durableWriteTempPath(target), target, JSON.stringify(snapshot))
}

export function journalSnapshotByteLength(snapshot: JournalSnapshotFile): number {
  return Buffer.byteLength(JSON.stringify(snapshot), 'utf8')
}

export async function readJournalLog(journalDir: string): Promise<JournalReadResult> {
  let raw: string
  try {
    raw = await readFile(join(journalDir, JOURNAL_LOG_FILE), 'utf-8')
  } catch {
    return { rows: [], unreadable: false, malformed: 0 }
  }
  const rows: JournalRow[] = []
  let unreadable = false
  let malformed = 0
  for (const line of raw.split('\n')) {
    if (!line.trim()) {
      continue
    }
    const parsed = parseJournalRow(line)
    if (parsed.ok) {
      rows.push(parsed.row)
      continue
    }
    if (parsed.unreadable) {
      unreadable = true
      break
    }
    malformed += 1
  }
  return { rows, unreadable, malformed }
}

/**
 * Append rows and fsync before returning. The caller treats a resolved promise
 * as "this row survives a power loss" — the write-ahead submission row depends
 * on exactly that, so this must never be relaxed to a buffered write.
 */
export async function appendJournalRows(
  journalDir: string,
  rows: readonly JournalRow[]
): Promise<void> {
  if (rows.length === 0) {
    return
  }
  const path = join(journalDir, JOURNAL_LOG_FILE)
  const payload = `${rows.map(serializeJournalRow).join('\n')}\n`
  await appendFile(path, payload, 'utf-8')
  const handle = await open(path, 'r+')
  try {
    await handle.sync()
  } finally {
    await handle.close()
  }
}

/** Replace the log with exactly the retained tail. Runs only after the snapshot
 *  carrying that tail is durable, so a crash here loses nothing. */
export async function rewriteJournalLog(
  journalDir: string,
  rows: readonly JournalRow[]
): Promise<void> {
  const target = join(journalDir, JOURNAL_LOG_FILE)
  const payload = rows.length ? `${rows.map(serializeJournalRow).join('\n')}\n` : ''
  await writeFileDurable(durableWriteTempPath(target), target, payload)
}
