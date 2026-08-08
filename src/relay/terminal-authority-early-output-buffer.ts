export const TERMINAL_AUTHORITY_EARLY_OUTPUT_MAX_BYTES = 100 * 1024
export const TERMINAL_AUTHORITY_EARLY_OUTPUT_MAX_FRAMES = 1_024

export class TerminalAuthorityEarlyOutputBuffer {
  private readonly chunks: string[] = []
  private bytes = 0
  private overflowed = false

  append(data: string): boolean {
    const bytes = Buffer.byteLength(data)
    if (
      this.overflowed ||
      this.chunks.length >= TERMINAL_AUTHORITY_EARLY_OUTPUT_MAX_FRAMES ||
      this.bytes + bytes > TERMINAL_AUTHORITY_EARLY_OUTPUT_MAX_BYTES
    ) {
      this.overflowed = true
      return false
    }
    this.chunks.push(data)
    this.bytes += bytes
    return true
  }

  values(): readonly string[] {
    return this.chunks
  }

  get exceededCapacity(): boolean {
    return this.overflowed
  }
}
