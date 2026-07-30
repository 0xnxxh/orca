import {
  readMobileProcessMemorySnapshot,
  type MobileProcessMemorySnapshot
} from '../diagnostics/mobile-process-memory-diagnostics'

export type MobileTerminalProcessMemoryReadiness = Readonly<{
  terminalRecordsLoaded: boolean
  renderedTerminalPaneCount: number
}>

export type MobileTerminalProcessMemoryReader = (
  platform: string
) => Promise<MobileProcessMemorySnapshot>

type SnapshotEmitter = (snapshot: MobileProcessMemorySnapshot) => void

export class MobileTerminalProcessMemoryDiagnostics {
  private sampleStarted = false

  constructor(
    private readonly enabled: boolean,
    private readonly emit: SnapshotEmitter,
    private readonly readProcessMemory: MobileTerminalProcessMemoryReader = readMobileProcessMemorySnapshot
  ) {}

  async sampleOnce(
    platform: string,
    readiness: MobileTerminalProcessMemoryReadiness
  ): Promise<void> {
    if (
      !this.enabled ||
      !readiness.terminalRecordsLoaded ||
      readiness.renderedTerminalPaneCount < 1 ||
      this.sampleStarted
    ) {
      return
    }
    this.sampleStarted = true
    this.emit(await this.readProcessMemory(platform))
  }
}
