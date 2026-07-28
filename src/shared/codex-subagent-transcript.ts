import { closeSync, openSync, readSync, readdirSync, statSync, type Stats } from 'node:fs'
import { dirname, extname, isAbsolute, join } from 'node:path'

import {
  finishCodexSubagent,
  upsertCodexSubagent,
  type CodexSubagentRoster
} from './codex-subagent-roster'

const TRANSCRIPT_READ_MAX_BYTES = 1024 * 1024
const TRANSCRIPT_LINE_MAX_BYTES = 256 * 1024
const TRANSCRIPT_DIRECTORY_MAX_ENTRIES = 4096
const SAFE_THREAD_ID = /^[A-Za-z0-9-]{1,64}$/

type JsonlCursor = {
  filePath?: string
  offset: number
  carry: string
}

type TrackedTranscriptSubagent = JsonlCursor & {
  description?: string
  startedAt: number
}

export type CodexSubagentTranscriptState = {
  parent: JsonlCursor
  subagents: Map<string, TrackedTranscriptSubagent>
}

type JsonRecord = Record<string, unknown>

function record(value: unknown): JsonRecord | undefined {
  return typeof value === 'object' && value !== null ? (value as JsonRecord) : undefined
}

function readJsonlCursor(cursor: JsonlCursor): JsonRecord[] {
  if (!cursor.filePath) {
    return []
  }
  let stats: Stats
  try {
    stats = statSync(cursor.filePath)
  } catch {
    return []
  }
  if (!stats.isFile()) {
    return []
  }
  if (stats.size < cursor.offset) {
    cursor.offset = 0
    cursor.carry = ''
  }
  if (stats.size === cursor.offset) {
    return []
  }
  const bytesToRead = Math.min(stats.size - cursor.offset, TRANSCRIPT_READ_MAX_BYTES)
  const start = stats.size - cursor.offset > bytesToRead ? stats.size - bytesToRead : cursor.offset
  const buffer = Buffer.allocUnsafe(bytesToRead)
  let bytesRead = 0
  let fd: number | undefined
  try {
    fd = openSync(cursor.filePath, 'r')
    bytesRead = readSync(fd, buffer, 0, bytesToRead, start)
  } catch {
    return []
  } finally {
    if (fd !== undefined) {
      closeSync(fd)
    }
  }
  const skippedPrefix = start !== cursor.offset
  const content = `${skippedPrefix ? '' : cursor.carry}${buffer.toString('utf8', 0, bytesRead)}`
  const lines = content.split('\n')
  cursor.offset = start + bytesRead
  cursor.carry = lines.pop() ?? ''
  if (skippedPrefix) {
    lines.shift()
  }
  const records: JsonRecord[] = []
  for (const line of lines) {
    if (Buffer.byteLength(line, 'utf8') > TRANSCRIPT_LINE_MAX_BYTES) {
      continue
    }
    try {
      const parsed = record(JSON.parse(line) as unknown)
      if (parsed) {
        records.push(parsed)
      }
    } catch {
      // A malformed rollout line must not block later lifecycle events.
    }
  }
  return records
}

function readTranscriptDirectory(parentPath: string): string[] {
  let entries: string[]
  try {
    entries = readdirSync(dirname(parentPath))
  } catch {
    return []
  }
  if (entries.length > TRANSCRIPT_DIRECTORY_MAX_ENTRIES) {
    entries = entries.slice(-TRANSCRIPT_DIRECTORY_MAX_ENTRIES)
  }
  return entries
}

function resolveChildTranscript(
  parentPath: string,
  entries: readonly string[],
  threadId: string
): string | undefined {
  if (!SAFE_THREAD_ID.test(threadId)) {
    return undefined
  }
  const suffix = `-${threadId}.jsonl`
  const fileName = entries.find((entry) => entry.endsWith(suffix))
  return fileName ? join(dirname(parentPath), fileName) : undefined
}

function readActivity(recordValue: JsonRecord):
  | {
      id: string
      description?: string
      kind: 'started' | 'interacted' | 'interrupted'
      startedAt: number
    }
  | undefined {
  if (recordValue.type !== 'event_msg') {
    return undefined
  }
  const payload = record(recordValue.payload)
  if (payload?.type !== 'sub_agent_activity') {
    return undefined
  }
  const id = typeof payload.agent_thread_id === 'string' ? payload.agent_thread_id.trim() : ''
  const rawKind = typeof payload.kind === 'string' ? payload.kind.toLowerCase() : ''
  if (
    !SAFE_THREAD_ID.test(id) ||
    (rawKind !== 'started' && rawKind !== 'interacted' && rawKind !== 'interrupted')
  ) {
    return undefined
  }
  return {
    id,
    description:
      typeof payload.agent_path === 'string' ? payload.agent_path.trim() || undefined : undefined,
    kind: rawKind,
    startedAt:
      typeof payload.occurred_at_ms === 'number' && Number.isFinite(payload.occurred_at_ms)
        ? payload.occurred_at_ms
        : Date.now()
  }
}

function childIsComplete(records: JsonRecord[]): boolean {
  let complete = false
  for (const recordValue of records) {
    if (recordValue.type !== 'event_msg') {
      continue
    }
    const payload = record(recordValue.payload)
    if (payload?.type === 'task_started') {
      complete = false
    } else if (payload?.type === 'task_complete') {
      complete = true
    }
  }
  return complete
}

export function createCodexSubagentTranscriptState(): CodexSubagentTranscriptState {
  return {
    parent: { offset: 0, carry: '' },
    subagents: new Map()
  }
}

export function hasTrackedCodexTranscriptSubagents(
  state: CodexSubagentTranscriptState | undefined
): boolean {
  return Boolean(state && state.subagents.size > 0)
}

export function reconcileCodexSubagentTranscript(
  state: CodexSubagentTranscriptState,
  roster: CodexSubagentRoster,
  transcriptPath: string | undefined
): void {
  const normalizedPath = transcriptPath?.trim()
  if (!normalizedPath || !isAbsolute(normalizedPath) || extname(normalizedPath) !== '.jsonl') {
    return
  }
  if (state.parent.filePath !== normalizedPath) {
    for (const id of state.subagents.keys()) {
      finishCodexSubagent(roster, id)
    }
    state.parent = { filePath: normalizedPath, offset: 0, carry: '' }
    state.subagents.clear()
  }
  for (const recordValue of readJsonlCursor(state.parent)) {
    const activity = readActivity(recordValue)
    if (!activity) {
      continue
    }
    if (activity.kind === 'interrupted') {
      finishCodexSubagent(roster, activity.id)
      state.subagents.delete(activity.id)
      continue
    }
    const tracked = state.subagents.get(activity.id) ?? {
      offset: 0,
      carry: '',
      startedAt: activity.startedAt
    }
    tracked.description = activity.description ?? tracked.description
    state.subagents.set(activity.id, tracked)
    upsertCodexSubagent(
      roster,
      activity.id,
      { description: tracked.description, state: 'working' },
      tracked.startedAt
    )
  }
  let directoryEntries: string[] | undefined
  for (const [id, tracked] of state.subagents) {
    if (!tracked.filePath) {
      directoryEntries ??= readTranscriptDirectory(normalizedPath)
      tracked.filePath = resolveChildTranscript(normalizedPath, directoryEntries, id)
    }
    if (!tracked.filePath || !childIsComplete(readJsonlCursor(tracked))) {
      continue
    }
    finishCodexSubagent(roster, id)
    state.subagents.delete(id)
  }
}
