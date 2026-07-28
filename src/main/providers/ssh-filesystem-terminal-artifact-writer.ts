import type { SshChannelMultiplexer } from '../ssh/ssh-channel-multiplexer'
import { isMethodNotFoundError } from '../ssh/ssh-filesystem-stream-reader'
import type { FileStat, TerminalArtifactAccessOptions } from './types'

export async function writeSshTerminalArtifact(
  mux: SshChannelMultiplexer,
  filePath: string,
  content: string,
  options: TerminalArtifactAccessOptions
): Promise<FileStat> {
  let result: { stat?: FileStat }
  try {
    result = (await mux.request('fs.writeTerminalArtifact', {
      filePath,
      content,
      expectedRealPath: options.expectedRealPath,
      expectedStatIdentity: options.expectedStatIdentity,
      maxBytes: options.maxBytes
    })) as { stat?: FileStat }
  } catch (error) {
    if (isMethodNotFoundError(error)) {
      throw new Error(
        'Remote terminal artifact access is unavailable. Reconnect the SSH target before retrying.'
      )
    }
    throw error
  }
  if (!result.stat) {
    throw new Error('terminal_file_grant_stale')
  }
  return result.stat
}
