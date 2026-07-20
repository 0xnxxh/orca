import { describe, expect, it } from 'vitest'
import { DaemonPtySessionRouting } from './daemon-pty-session-routing'

type Owner = { label: string }

const processInfo = (id: string) => ({ id, cwd: '', title: id })

describe('DaemonPtySessionRouting', () => {
  it('applies a daemon snapshot beside a newer fallback spawn', () => {
    const fallback: Owner = { label: 'fallback' }
    const daemon: Owner = { label: 'daemon' }
    const routing = new DaemonPtySessionRouting<Owner>()
    const refresh = routing.beginInventoryRefresh()

    routing.add('duplicate', fallback)
    const ambiguous = routing.refreshLive(
      [fallback, daemon],
      [[], [processInfo('duplicate')]],
      refresh
    )

    expect(ambiguous).toEqual(['duplicate'])
    expect(routing.isAmbiguous('duplicate')).toBe(true)
  })

  it('supersedes an older provider snapshot even when the newer snapshot is empty', () => {
    const owner: Owner = { label: 'daemon' }
    const routing = new DaemonPtySessionRouting<Owner>()
    const older = routing.beginInventoryRefresh()
    const newer = routing.beginInventoryRefresh()

    routing.refreshLive([owner], [[]], newer)
    routing.refreshLive([owner], [[processInfo('stale')]], older)

    expect(routing.get('stale')).toBeUndefined()
  })

  it('reports logical exit only after the final physical owner exits', () => {
    const first: Owner = { label: 'first' }
    const second: Owner = { label: 'second' }
    const third: Owner = { label: 'third' }
    const routing = new DaemonPtySessionRouting<Owner>()
    routing.add('duplicate', first)
    routing.add('duplicate', second)
    routing.add('duplicate', third)

    expect(routing.handleExit('duplicate', first)).toBe(false)
    expect(routing.handleExit('duplicate', second)).toBe(false)
    expect(routing.handleExit('duplicate', third)).toBe(true)
  })

  it('prunes absent live routes but preserves an intentionally sleeping owner', () => {
    const owner: Owner = { label: 'legacy' }
    const routing = new DaemonPtySessionRouting<Owner>()
    routing.add('stale-live', owner)
    let refresh = routing.beginInventoryRefresh()
    routing.refreshLive([owner], [[]], refresh)
    expect(routing.get('stale-live')).toBeUndefined()

    routing.add('sleeping', owner)
    routing.beginSleep('sleeping', owner)
    expect(routing.handleExit('sleeping', owner)).toBe(false)
    refresh = routing.beginInventoryRefresh()
    routing.refreshLive([owner], [[]], refresh)

    expect(routing.get('sleeping')).toBe(owner)
    routing.add('sleeping', owner)
    expect(routing.handleExit('sleeping', owner)).toBe(true)
  })

  it('does not let an in-progress sleep inventory expose its expected exit', () => {
    const owner: Owner = { label: 'legacy' }
    const routing = new DaemonPtySessionRouting<Owner>()
    routing.add('sleeping', owner)
    routing.beginSleep('sleeping', owner)
    const refresh = routing.beginInventoryRefresh()

    routing.refreshLive([owner], [[processInfo('sleeping')]], refresh)

    expect(routing.handleExit('sleeping', owner)).toBe(false)
    expect(routing.get('sleeping')).toBe(owner)
  })
})
