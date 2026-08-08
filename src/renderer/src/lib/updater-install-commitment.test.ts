// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import {
  ORCA_UPDATER_QUIT_AND_INSTALL_ABORTED_EVENT,
  ORCA_UPDATER_QUIT_AND_INSTALL_STARTED_EVENT
} from '../../../shared/updater-renderer-events'
import {
  isUpdaterInstallCommitted,
  registerUpdaterInstallCommitment,
  resetUpdaterInstallCommitmentForTest
} from './updater-install-commitment'

const listeners: ((committed: boolean) => void)[] = []

function installBridge(seed: boolean | 'never' = false): void {
  ;(window as unknown as { api: unknown }).api = {
    updater: {
      isInstallCommitted: () =>
        seed === 'never' ? new Promise<boolean>(() => undefined) : Promise.resolve(seed),
      onInstallCommitted: (cb: (committed: boolean) => void) => {
        listeners.push(cb)
        return () => {
          listeners.splice(listeners.indexOf(cb), 1)
        }
      }
    }
  }
}

const broadcast = (committed: boolean): void => {
  for (const listener of listeners.slice()) {
    listener(committed)
  }
}

describe('renderer updater install commitment', () => {
  let unregister: (() => void) | null = null

  beforeEach(() => {
    listeners.length = 0
    resetUpdaterInstallCommitmentForTest()
  })

  afterEach(() => {
    unregister?.()
    unregister = null
    resetUpdaterInstallCommitmentForTest()
    delete (window as unknown as { api?: unknown }).api
    vi.restoreAllMocks()
  })

  it('believes main over anything local', () => {
    installBridge()
    unregister = registerUpdaterInstallCommitment()

    expect(isUpdaterInstallCommitted()).toBe(false)
    broadcast(true)
    expect(isUpdaterInstallCommitted()).toBe(true)
  })

  it('arms the initiating window before main answers', () => {
    // This window dispatched the start event itself; waiting for the round trip
    // would leave a gap exactly when the archive is being replaced.
    installBridge('never')
    unregister = registerUpdaterInstallCommitment()

    window.dispatchEvent(new Event(ORCA_UPDATER_QUIT_AND_INSTALL_STARTED_EVENT))

    expect(isUpdaterInstallCommitted()).toBe(true)
  })

  it('ignores a local abort while main still says an install is committed', () => {
    installBridge()
    unregister = registerUpdaterInstallCommitment()
    broadcast(true)

    window.dispatchEvent(new Event(ORCA_UPDATER_QUIT_AND_INSTALL_ABORTED_EVENT))

    // Only main can stand the archive back up.
    expect(isUpdaterInstallCommitted()).toBe(true)
  })

  it('stands down on main clearing, including a local arm', () => {
    installBridge()
    unregister = registerUpdaterInstallCommitment()
    window.dispatchEvent(new Event(ORCA_UPDATER_QUIT_AND_INSTALL_STARTED_EVENT))

    broadcast(false)

    expect(isUpdaterInstallCommitted()).toBe(false)
  })

  it('seeds a window that opened after the broadcast went out', async () => {
    installBridge(true)
    unregister = registerUpdaterInstallCommitment()

    await Promise.resolve()
    await Promise.resolve()

    expect(isUpdaterInstallCommitted()).toBe(true)
  })

  it('survives a renderer with no updater bridge at all', () => {
    ;(window as unknown as { api: unknown }).api = {}

    expect(() => {
      unregister = registerUpdaterInstallCommitment()
    }).not.toThrow()
    expect(isUpdaterInstallCommitted()).toBe(false)
  })

  it('detaches cleanly so a stale listener cannot re-arm a new document', () => {
    installBridge()
    const stop = registerUpdaterInstallCommitment()
    broadcast(true)

    stop()

    expect(isUpdaterInstallCommitted()).toBe(false)
    expect(listeners).toHaveLength(0)
  })
})
