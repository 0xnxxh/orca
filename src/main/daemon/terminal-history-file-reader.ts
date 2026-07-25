import {
  readNodeFileSyncWithinLimit,
  readNodeFileWithinLimit
} from '../../shared/node-bounded-file-reader'

export function readTerminalHistoryBuffer(filePath: string, maxBytes: number): Buffer {
  return readNodeFileSyncWithinLimit(filePath, maxBytes).buffer
}

export function readTerminalHistoryText(filePath: string, maxBytes: number): string {
  return readTerminalHistoryBuffer(filePath, maxBytes).toString('utf8')
}

// Why no JSON structure pre-scan here: checkpoint.json and meta.json are our own
// writer's output, not untrusted input. The byte cap already bounds the read, a
// corrupt file fails JSON.parse and every caller already treats that as "no
// history", and a per-character JS scan in front of native JSON.parse cost ~57%
// of this read path on a large checkpoint while making numerous oscLinks restore
// blank. Untrusted JSON still goes through assertJsonTextStructureWithinLimits.
export function readTerminalHistoryJson<T>(filePath: string, maxBytes: number): T {
  return JSON.parse(readTerminalHistoryText(filePath, maxBytes)) as T
}

// Why: cold-restore payload reads must not block the main thread, but need the
// same byte bound as the sync readers.
export async function readTerminalHistoryBufferAsync(
  filePath: string,
  maxBytes: number
): Promise<Buffer> {
  return (await readNodeFileWithinLimit(filePath, maxBytes)).buffer
}

export async function readTerminalHistoryTextAsync(
  filePath: string,
  maxBytes: number
): Promise<string> {
  return (await readTerminalHistoryBufferAsync(filePath, maxBytes)).toString('utf8')
}

export async function readTerminalHistoryJsonAsync<T>(
  filePath: string,
  maxBytes: number
): Promise<T> {
  return JSON.parse(await readTerminalHistoryTextAsync(filePath, maxBytes)) as T
}
