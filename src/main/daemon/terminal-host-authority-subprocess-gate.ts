import type { SubprocessHandle } from './session'
import { TerminalHostAuthorityOutputBuffer } from './terminal-host-authority-output-buffer'

export class TerminalHostAuthoritySubprocessGate implements SubprocessHandle {
  readonly pid: number
  readonly startupCommandDeliveredInShellArgs: boolean | undefined
  readonly shellPath: string | undefined
  readonly slavePath: string | undefined
  private readonly output = new TerminalHostAuthorityOutputBuffer()
  private dataConsumer: ((data: string) => void) | null = null
  private exitConsumer: ((code: number) => void) | null = null
  private exitCode: number | undefined
  private released = false

  constructor(private readonly subprocess: SubprocessHandle) {
    this.pid = subprocess.pid
    this.startupCommandDeliveredInShellArgs = subprocess.startupCommandDeliveredInShellArgs
    this.shellPath = subprocess.shellPath
    this.slavePath = subprocess.slavePath
    subprocess.pause?.()
    subprocess.onData((data) => {
      if (this.released) {
        this.dataConsumer?.(data)
        return
      }
      this.output.append({ data })
    })
    subprocess.onExit((code) => {
      if (this.released) {
        this.exitConsumer?.(code)
        return
      }
      this.exitCode ??= code
    })
  }

  get exceededCapacity(): boolean {
    return this.output.exceededCapacity
  }

  get exitedBeforeRelease(): boolean {
    return this.exitCode !== undefined
  }

  release(): void {
    if (this.released) {
      return
    }
    if (this.output.exceededCapacity) {
      throw new Error('terminal_session_authority_early_output_capacity_exceeded')
    }
    this.released = true
    for (const frame of this.output.drain()) {
      this.dataConsumer?.(frame.data)
    }
    if (this.exitCode !== undefined) {
      this.exitConsumer?.(this.exitCode)
    } else {
      this.subprocess.resume?.()
    }
  }

  releaseForShutdown(): void {
    if (this.released) {
      return
    }
    this.released = true
    this.output.drain()
    if (this.exitCode !== undefined) {
      this.exitConsumer?.(this.exitCode)
    }
  }

  getForegroundProcess(): string | null {
    return this.subprocess.getForegroundProcess()
  }

  async confirmForegroundProcess(): Promise<string | null> {
    return await Promise.resolve(
      this.subprocess.confirmForegroundProcess?.() ?? this.subprocess.getForegroundProcess()
    )
  }

  write(data: string): void {
    this.subprocess.write(data)
  }

  resize(cols: number, rows: number): void {
    this.subprocess.resize(cols, rows)
  }

  pause(): void {
    this.subprocess.pause?.()
  }

  resume(): void {
    if (this.released) {
      this.subprocess.resume?.()
    }
  }

  clear(): void {
    this.subprocess.clear?.()
  }

  kill(): void {
    this.subprocess.kill()
  }

  forceKill(): void {
    this.subprocess.forceKill()
  }

  signal(sig: string): void {
    this.subprocess.signal(sig)
  }

  onData(cb: (data: string) => void): void {
    this.dataConsumer = cb
  }

  onExit(cb: (code: number) => void): void {
    this.exitConsumer = cb
  }

  dispose(): void {
    this.subprocess.dispose()
  }
}
