// Byte-accurate JSONL line reading for resumable transcript parses: offsets
// must count bytes (not UTF-8-decoded characters) so a resumed read starts
// exactly where the last complete line ended.
// Parser output is cached on disk across app versions: if a change here alters
// the line content parsers see for the same bytes (the CR/LF trim), bump
// PARSER_REVISION in session-parse-cache-persistence.ts.
import { createReadStream } from 'node:fs'
import { open } from 'node:fs/promises'

const NEWLINE_BYTE = 0x0a
const CARRIAGE_RETURN_BYTE = 0x0d

export type JsonlReadResult = {
  consumedThrough: number
  trailingPartialLine: string | null
  bytesRead: number
}

// A resume point is only valid if it still sits just past a line break;
// anything else means the file was rewritten, not appended. Heuristic: a
// grown rewrite keeping '\n' at exactly this byte would slip through, but
// agent transcripts are append-only so that trade is accepted (worst case is
// a stale vault row until the file is next truncated or the app restarts).
export async function endsWithNewlineAt(path: string, offset: number): Promise<boolean> {
  // Node reads from the handle's current position (0) when given -1, so an
  // offset of 0 would report a resume point for any file starting with '\n'.
  if (offset <= 0) {
    return false
  }
  const handle = await open(path, 'r')
  try {
    const { bytesRead, buffer } = await handle.read(Buffer.alloc(1), 0, 1, offset - 1)
    return bytesRead === 1 && buffer[0] === NEWLINE_BYTE
  } finally {
    await handle.close()
  }
}

export async function consumeCompleteJsonlLines(args: {
  path: string
  start: number
  onLine: (line: string) => void
}): Promise<JsonlReadResult> {
  let consumedThrough = args.start
  let bytesRead = 0
  // Why a piece list: re-joining the partial line with every chunk made one
  // oversized record (a big tool result) cost O(record^2). Joining once, when a
  // newline finally arrives, keeps it linear.
  let remainderParts: Buffer[] = []
  let remainderLength = 0

  const stream = createReadStream(args.path, { start: args.start })
  for await (const chunk of stream as AsyncIterable<Buffer>) {
    bytesRead += chunk.length
    // Why check the chunk alone: the pieces held over are all mid-line, so none
    // of them contains a newline.
    if (!chunk.includes(NEWLINE_BYTE)) {
      remainderParts.push(chunk)
      remainderLength += chunk.length
      continue
    }
    const data =
      remainderLength > 0
        ? Buffer.concat([...remainderParts, chunk], remainderLength + chunk.length)
        : chunk
    remainderParts = []
    remainderLength = 0
    let lineStart = 0
    let newlineIndex = data.indexOf(NEWLINE_BYTE, lineStart)
    while (newlineIndex !== -1) {
      let lineEnd = newlineIndex
      if (lineEnd > lineStart && data[lineEnd - 1] === CARRIAGE_RETURN_BYTE) {
        lineEnd--
      }
      args.onLine(data.toString('utf-8', lineStart, lineEnd))
      lineStart = newlineIndex + 1
      newlineIndex = data.indexOf(NEWLINE_BYTE, lineStart)
    }
    consumedThrough += lineStart
    if (lineStart < data.length) {
      // Copy the tail so retaining it doesn't pin the whole chunk buffer.
      remainderParts = [Buffer.from(data.subarray(lineStart))]
      remainderLength = data.length - lineStart
    }
  }

  const trailingPartialLine =
    remainderLength > 0 ? Buffer.concat(remainderParts, remainderLength).toString('utf-8') : null

  return {
    consumedThrough,
    trailingPartialLine,
    bytesRead
  }
}
