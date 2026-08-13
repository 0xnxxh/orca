import { wslGatedStat } from './wsl-transcript-fs-access'

export type TranscriptFileVersion = {
  identity: string
  size: number
  mtimeMs: number
  ctimeMs: number
}

export async function readTranscriptFileVersion(
  filePath: string,
  signal?: AbortSignal
): Promise<TranscriptFileVersion> {
  const value = await wslGatedStat(filePath, 'exact', signal)
  return {
    identity: `${value.dev}:${value.ino}`,
    size: value.size,
    mtimeMs: value.mtimeMs,
    ctimeMs: value.ctimeMs
  }
}

export function transcriptFileVersionChanged(
  current: TranscriptFileVersion,
  previous: TranscriptFileVersion
): boolean {
  return (
    current.identity !== previous.identity ||
    current.size !== previous.size ||
    current.mtimeMs !== previous.mtimeMs ||
    current.ctimeMs !== previous.ctimeMs
  )
}
