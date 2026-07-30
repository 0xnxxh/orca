export type MobileTerminalSurfaceTotals = Readonly<{
  terminalRecordCount: number
  terminalTabCount: number
  tabCount: number
}>

export type MobileTerminalWebViewCountSnapshot = MobileTerminalSurfaceTotals &
  Readonly<{
    boundary: 'mount' | 'unmount' | 'activity-change' | 'session-snapshot' | 'route-reset'
    mountedWebViewCount: number
    activeMountedWebViewCount: number
    inactiveMountedWebViewCount: number
  }>

type SnapshotEmitter = (snapshot: MobileTerminalWebViewCountSnapshot) => void

declare const mobileTerminalWebViewMountIdentityBrand: unique symbol

type MobileTerminalWebViewMountIdentity = Readonly<{
  [mobileTerminalWebViewMountIdentityBrand]: true
}>

export type MobileTerminalWebViewMountLifecycle = Readonly<{
  mounted: (active: boolean) => void
  activityChanged: (active: boolean) => void
  unmounted: () => void
}>

const EMPTY_TOTALS: MobileTerminalSurfaceTotals = {
  terminalRecordCount: 0,
  terminalTabCount: 0,
  tabCount: 0
}

export class MobileTerminalWebViewCountDiagnostics {
  private readonly mountedActivityByIdentity: Map<
    MobileTerminalWebViewMountIdentity,
    boolean
  > | null
  private totals = EMPTY_TOTALS

  constructor(
    enabled: boolean,
    private readonly emit: SnapshotEmitter
  ) {
    this.mountedActivityByIdentity = enabled ? new Map() : null
  }

  private createMountIdentity(): MobileTerminalWebViewMountIdentity | null {
    return this.mountedActivityByIdentity ? ({} as MobileTerminalWebViewMountIdentity) : null
  }

  createMountLifecycle(): MobileTerminalWebViewMountLifecycle | null {
    const identity = this.createMountIdentity()
    return identity
      ? {
          mounted: (active) => this.mounted(identity, active),
          activityChanged: (active) => this.activityChanged(identity, active),
          unmounted: () => this.unmounted(identity)
        }
      : null
  }

  private mounted(identity: MobileTerminalWebViewMountIdentity, active: boolean): void {
    const mounted = this.mountedActivityByIdentity
    if (!mounted || mounted.has(identity)) {
      return
    }
    mounted.set(identity, active)
    this.emitSnapshot('mount')
  }

  private activityChanged(identity: MobileTerminalWebViewMountIdentity, active: boolean): void {
    const mounted = this.mountedActivityByIdentity
    if (!mounted || !mounted.has(identity) || mounted.get(identity) === active) {
      return
    }
    mounted.set(identity, active)
    this.emitSnapshot('activity-change')
  }

  private unmounted(identity: MobileTerminalWebViewMountIdentity): void {
    if (!this.mountedActivityByIdentity?.delete(identity)) {
      return
    }
    this.emitSnapshot('unmount')
  }

  sessionSnapshot(totals: MobileTerminalSurfaceTotals): void {
    if (
      !this.mountedActivityByIdentity ||
      (this.totals.terminalRecordCount === totals.terminalRecordCount &&
        this.totals.terminalTabCount === totals.terminalTabCount &&
        this.totals.tabCount === totals.tabCount)
    ) {
      return
    }
    this.totals = totals
    this.emitSnapshot('session-snapshot')
  }

  resetRoute(): void {
    if (!this.mountedActivityByIdentity) {
      return
    }
    this.mountedActivityByIdentity.clear()
    this.totals = EMPTY_TOTALS
    this.emitSnapshot('route-reset')
  }

  retainedEntryCount(): number {
    return this.mountedActivityByIdentity?.size ?? 0
  }

  private emitSnapshot(boundary: MobileTerminalWebViewCountSnapshot['boundary']): void {
    const activity = [...(this.mountedActivityByIdentity?.values() ?? [])]
    const activeMountedWebViewCount = activity.filter(Boolean).length
    this.emit({
      boundary,
      mountedWebViewCount: activity.length,
      activeMountedWebViewCount,
      inactiveMountedWebViewCount: activity.length - activeMountedWebViewCount,
      ...this.totals
    })
  }
}
