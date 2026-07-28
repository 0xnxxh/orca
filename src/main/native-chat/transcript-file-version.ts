import {
  localTranscriptFileSource,
  type TranscriptFileSource,
  type TranscriptFileVersion
} from './transcript-file-source'

export type { TranscriptFileVersion } from './transcript-file-source'

export async function readTranscriptFileVersion(
  filePath: string,
  fileSource: TranscriptFileSource = localTranscriptFileSource
): Promise<TranscriptFileVersion> {
  return fileSource.stat(filePath)
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
