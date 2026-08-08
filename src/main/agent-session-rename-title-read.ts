import { createReadStream } from 'node:fs'
import { stat } from 'node:fs/promises'
import { createInterface } from 'node:readline'
import {
  CLAUDE_CUSTOM_TITLE_RECORD_MARKER,
  findClaudeSessionRenameRecord,
  type ClaudeSessionRenameRecord
} from '../shared/agent-session-rename-title'

// Why: Claude re-appends the rename record on most turns, so measured against
// real transcripts (2.8 MB / 37 records, newest 403 B from EOF) a short tail
// answers nearly every scan. A rename that is never re-appended exists only
// once, near the top, so an empty tail widens.
const TRANSCRIPT_TAIL_SCAN_BYTES = 256 * 1024
// Why: the widened scan streams rather than buffers, but cap how far back it
// starts — a rename that old is already superseded by the tab's persisted value.
const MAX_TRANSCRIPT_SCAN_BYTES = 64 * 1024 * 1024

/** Local transcripts only — the renderer skips panes hosted over SSH. */
export type AgentSessionRenamedTitleArgs = { transcriptPath: string }

/**
 * The deliberate rename (Claude `/rename`) recorded in one agent transcript, or
 * null when the session has none. Best-effort: any read failure — including an
 * ill-typed IPC payload — resolves null so the tab keeps its generated title.
 */
export async function readAgentSessionRenamedTitle(
  args: AgentSessionRenamedTitleArgs
): Promise<string | null> {
  try {
    const transcriptPath = args.transcriptPath.trim()
    return transcriptPath ? await readLocalRenamedTitle(transcriptPath) : null
  } catch {
    return null
  }
}

async function readLocalRenamedTitle(transcriptPath: string): Promise<string | null> {
  const { size } = await stat(transcriptPath)
  const tailStart = Math.max(0, size - TRANSCRIPT_TAIL_SCAN_BYTES)
  const fromTail = await scanTranscriptFrom(transcriptPath, tailStart)
  if (fromTail || tailStart === 0) {
    return fromTail?.customTitle ?? null
  }
  const widened = await scanTranscriptFrom(
    transcriptPath,
    Math.max(0, size - MAX_TRANSCRIPT_SCAN_BYTES)
  )
  return widened?.customTitle ?? null
}

async function scanTranscriptFrom(
  transcriptPath: string,
  start: number
): Promise<ClaudeSessionRenameRecord | null> {
  const stream = createReadStream(transcriptPath, { encoding: 'utf8', start })
  try {
    // Why: transcripts are mostly long message records — keep only the lines
    // that can carry a rename instead of buffering the file.
    const candidates: string[] = []
    for await (const line of createInterface({ input: stream, crlfDelay: Infinity })) {
      if (line.includes(CLAUDE_CUSTOM_TITLE_RECORD_MARKER)) {
        candidates.push(line)
      }
    }
    return findClaudeSessionRenameRecord(candidates)
  } finally {
    stream.destroy()
  }
}
