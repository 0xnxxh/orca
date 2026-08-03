import type {
  FilesystemHostLane,
  FilesystemHostProcessHandle
} from './filesystem-host-supervisor-scheduling'

export class FilesystemHostProcessRetirement {
  readonly abandoned = new Set<FilesystemHostProcessHandle>()
  readonly didNotExitDomainByChild = new Map<FilesystemHostProcessHandle, string>()
  private readonly releaseByChild = new Map<FilesystemHostProcessHandle, () => void>()

  track(process: FilesystemHostProcessHandle, release: () => void): void {
    this.releaseByChild.set(process, release)
  }

  physicalExit(lane: FilesystemHostLane, process: FilesystemHostProcessHandle): void {
    this.releaseByChild.get(process)?.()
    this.clear(lane, process)
  }

  async retire(
    laneKey: string,
    lane: FilesystemHostLane,
    process: FilesystemHostProcessHandle
  ): Promise<boolean> {
    if (lane.process === process) {
      lane.process = null
    }
    this.abandoned.add(process)
    const didExit = await process.retire().catch(() => false)
    if (didExit) {
      this.physicalExit(lane, process)
    } else {
      this.didNotExitDomainByChild.set(process, laneKey)
    }
    return didExit
  }

  private clear(lane: FilesystemHostLane, process: FilesystemHostProcessHandle): void {
    this.releaseByChild.delete(process)
    this.abandoned.delete(process)
    this.didNotExitDomainByChild.delete(process)
    if (lane.process === process) {
      lane.process = null
    }
  }
}
