import { getTerminalInputByteLength } from '../../shared/terminal-input'

const MAX_BUFFERED_WRITE_BYTES = 64 * 1024
const MAX_BUFFERED_WRITE_SESSIONS = 256

export type BufferedDaemonWrites = {
  sessionId: string
  data: string
}

export class DaemonDroppedWriteBuffer {
  private chunksBySessionId = new Map<string, string[]>()
  private bufferedBytes = 0

  get hasWrites(): boolean {
    return this.chunksBySessionId.size > 0
  }

  enqueue(sessionId: string, data: string): boolean {
    const bytes = getTerminalInputByteLength(data)
    if (
      this.bufferedBytes + bytes > MAX_BUFFERED_WRITE_BYTES ||
      (!this.chunksBySessionId.has(sessionId) &&
        this.chunksBySessionId.size >= MAX_BUFFERED_WRITE_SESSIONS)
    ) {
      return false
    }
    const chunks = this.chunksBySessionId.get(sessionId) ?? []
    chunks.push(data)
    this.chunksBySessionId.set(sessionId, chunks)
    this.bufferedBytes += bytes
    return true
  }

  drain(): BufferedDaemonWrites[] {
    const writes = [...this.chunksBySessionId].map(([sessionId, chunks]) => ({
      sessionId,
      data: chunks.join('')
    }))
    this.clear()
    return writes
  }

  delete(sessionId: string): void {
    const chunks = this.chunksBySessionId.get(sessionId)
    if (!chunks) {
      return
    }
    this.chunksBySessionId.delete(sessionId)
    this.bufferedBytes -= getTerminalInputByteLength(chunks.join(''))
  }

  clear(): void {
    this.chunksBySessionId.clear()
    this.bufferedBytes = 0
  }
}
