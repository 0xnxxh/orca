import { describe, expect, it, vi } from 'vitest'
import {
  MobileTerminalWebViewCountDiagnostics,
  type MobileTerminalWebViewCountSnapshot
} from './mobile-terminal-webview-count-diagnostics'

function createDiagnostics() {
  const snapshots: MobileTerminalWebViewCountSnapshot[] = []
  return {
    diagnostics: new MobileTerminalWebViewCountDiagnostics(true, (snapshot) =>
      snapshots.push(snapshot)
    ),
    snapshots
  }
}

describe('mobile terminal WebView count diagnostics', () => {
  it.each([10, 50])('aggregates a %i-terminal retained set', (terminalCount) => {
    const { diagnostics, snapshots } = createDiagnostics()
    diagnostics.sessionSnapshot({
      terminalRecordCount: terminalCount,
      terminalTabCount: terminalCount,
      tabCount: terminalCount + 2
    })
    for (let index = 0; index < terminalCount; index += 1) {
      diagnostics.createMountLifecycle()!.mounted(index === terminalCount - 1)
    }

    expect(snapshots.at(-1)).toEqual({
      boundary: 'mount',
      mountedWebViewCount: terminalCount,
      activeMountedWebViewCount: 1,
      inactiveMountedWebViewCount: terminalCount - 1,
      terminalRecordCount: terminalCount,
      terminalTabCount: terminalCount,
      tabCount: terminalCount + 2
    })
  })

  it('replays setup-cleanup-setup with one retained mount', () => {
    const { diagnostics, snapshots } = createDiagnostics()
    const lifecycle = diagnostics.createMountLifecycle()!

    lifecycle.mounted(true)
    lifecycle.unmounted()
    lifecycle.mounted(true)
    lifecycle.mounted(true)
    lifecycle.activityChanged(true)

    expect(snapshots.map((snapshot) => snapshot.boundary)).toEqual(['mount', 'unmount', 'mount'])
    expect(snapshots.at(-1)?.mountedWebViewCount).toBe(1)
    expect(diagnostics.retainedEntryCount()).toBe(1)
  })

  it('tracks active changes independently of mount state', () => {
    const { diagnostics, snapshots } = createDiagnostics()
    const firstLifecycle = diagnostics.createMountLifecycle()!
    const secondLifecycle = diagnostics.createMountLifecycle()!
    firstLifecycle.mounted(true)
    secondLifecycle.mounted(false)
    firstLifecycle.activityChanged(false)
    secondLifecycle.activityChanged(true)

    expect(snapshots.at(-1)).toMatchObject({
      boundary: 'activity-change',
      mountedWebViewCount: 2,
      activeMountedWebViewCount: 1,
      inactiveMountedWebViewCount: 1
    })
  })

  it('clears mounted identities and totals at a route reset', () => {
    const { diagnostics, snapshots } = createDiagnostics()
    const lifecycle = diagnostics.createMountLifecycle()!
    diagnostics.sessionSnapshot({
      terminalRecordCount: 2,
      terminalTabCount: 3,
      tabCount: 4
    })
    lifecycle.mounted(true)

    diagnostics.resetRoute()
    lifecycle.unmounted()

    expect(diagnostics.retainedEntryCount()).toBe(0)
    expect(snapshots.at(-1)).toEqual({
      boundary: 'route-reset',
      mountedWebViewCount: 0,
      activeMountedWebViewCount: 0,
      inactiveMountedWebViewCount: 0,
      terminalRecordCount: 0,
      terminalTabCount: 0,
      tabCount: 0
    })
  })

  it('ignores a late old unmount after reset and a new same-handle pane mount', () => {
    const { diagnostics, snapshots } = createDiagnostics()
    const oldPaneLifecycle = diagnostics.createMountLifecycle()!
    oldPaneLifecycle.mounted(true)
    diagnostics.resetRoute()

    const newPaneLifecycle = diagnostics.createMountLifecycle()!
    newPaneLifecycle.mounted(true)
    const snapshotCount = snapshots.length
    oldPaneLifecycle.unmounted()

    expect(snapshots).toHaveLength(snapshotCount)
    expect(snapshots.at(-1)).toMatchObject({
      boundary: 'mount',
      mountedWebViewCount: 1,
      activeMountedWebViewCount: 1
    })
    expect(diagnostics.retainedEntryCount()).toBe(1)
  })

  it('allocates no retained entries or emissions while disabled', () => {
    const emit = vi.fn()
    const diagnostics = new MobileTerminalWebViewCountDiagnostics(false, emit)

    expect(diagnostics.createMountLifecycle()).toBeNull()
    diagnostics.sessionSnapshot({
      terminalRecordCount: 1,
      terminalTabCount: 1,
      tabCount: 1
    })
    diagnostics.resetRoute()

    expect(diagnostics.retainedEntryCount()).toBe(0)
    expect(emit).not.toHaveBeenCalled()
  })

  it('emits only bounded aggregate fields', () => {
    const { diagnostics, snapshots } = createDiagnostics()
    diagnostics.createMountLifecycle()!.mounted(true)

    expect(Object.keys(snapshots[0]).sort()).toEqual(
      [
        'activeMountedWebViewCount',
        'boundary',
        'inactiveMountedWebViewCount',
        'mountedWebViewCount',
        'tabCount',
        'terminalRecordCount',
        'terminalTabCount'
      ].sort()
    )
  })
})
