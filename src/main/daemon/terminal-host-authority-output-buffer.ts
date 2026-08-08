export const TERMINAL_HOST_AUTHORITY_OUTPUT_MAX_BYTES = 100 * 1024
export const TERMINAL_HOST_AUTHORITY_OUTPUT_MAX_FRAMES = 1_024

export type TerminalHostBufferedOutput = Readonly<{
  data: string
  rawLength?: number
  transformed?: boolean
  seq?: number
}>

export class TerminalHostAuthorityOutputBuffer {
  private readonly frames: TerminalHostBufferedOutput[] = []
  private bytes = 0
  private overflowed = false

  append(frame: TerminalHostBufferedOutput): boolean {
    const bytes = Buffer.byteLength(frame.data)
    if (
      this.overflowed ||
      this.frames.length >= TERMINAL_HOST_AUTHORITY_OUTPUT_MAX_FRAMES ||
      this.bytes + bytes > TERMINAL_HOST_AUTHORITY_OUTPUT_MAX_BYTES
    ) {
      this.overflowed = true
      return false
    }
    this.frames.push(Object.freeze({ ...frame }))
    this.bytes += bytes
    return true
  }

  drain(): readonly TerminalHostBufferedOutput[] {
    const drained = this.frames.splice(0)
    this.bytes = 0
    return drained
  }

  get exceededCapacity(): boolean {
    return this.overflowed
  }
}
