// @vitest-environment happy-dom
import { afterEach, describe, expect, it, vi } from 'vitest'
import { ORCA_RENDERER_UNLOAD_PREVENTED_EVENT } from '../../../shared/renderer-shutdown-events'
import { requestLazyChunkRecoveryReload } from './lazy-chunk-recovery-reload'

type HostReload = () => Promise<boolean>

function installHostBridge(reload: HostReload): void {
  ;(window as unknown as { api: unknown }).api = { app: { reload } }
}

describe('requestLazyChunkRecoveryReload', () => {
  afterEach(() => {
    vi.restoreAllMocks()
    delete (window as unknown as { api?: unknown }).api
  })

  it('refuses the reload when the staged checkpoint never reaches disk', async () => {
    const reload = vi.spyOn(window.location, 'reload').mockImplementation(() => undefined)

    await expect(
      requestLazyChunkRecoveryReload(window, () =>
        Promise.reject(new Error('Failed to persist renderer state before unload.'))
      )
    ).resolves.toBe('checkpoint-refused')

    expect(reload).not.toHaveBeenCalled()
  })

  it('navigates only after the checkpoint is durably written', async () => {
    const order: string[] = []
    vi.spyOn(window.location, 'reload').mockImplementation(() => {
      order.push('reload')
      // A real landed reload destroys the document; veto so the wait settles.
      window.dispatchEvent(new Event(ORCA_RENDERER_UNLOAD_PREVENTED_EVENT))
    })

    await expect(
      requestLazyChunkRecoveryReload(window, async () => {
        order.push('flushed')
      })
    ).resolves.toBe('unload-vetoed')

    expect(order).toEqual(['flushed', 'reload'])
  })

  it('asks the host for a browser-initiated reload instead of navigating in-document', async () => {
    const locationReload = vi.spyOn(window.location, 'reload').mockImplementation(() => undefined)
    const hostReload = vi.fn(async () => {
      // A real landed reload destroys the document; veto so the wait settles.
      window.dispatchEvent(new Event(ORCA_RENDERER_UNLOAD_PREVENTED_EVENT))
      return true
    })
    installHostBridge(hostReload)

    await expect(requestLazyChunkRecoveryReload(window, async () => undefined)).resolves.toBe(
      'unload-vetoed'
    )

    expect(hostReload).toHaveBeenCalledTimes(1)
    expect(locationReload).not.toHaveBeenCalled()
  })

  it('falls back in-document when the host declines the sender', async () => {
    const locationReload = vi.spyOn(window.location, 'reload').mockImplementation(() => {
      window.dispatchEvent(new Event(ORCA_RENDERER_UNLOAD_PREVENTED_EVENT))
    })
    const hostReload = vi.fn(async () => false)
    installHostBridge(hostReload)

    await expect(requestLazyChunkRecoveryReload(window, async () => undefined)).resolves.toBe(
      'unload-vetoed'
    )

    expect(hostReload).toHaveBeenCalledTimes(1)
    expect(locationReload).toHaveBeenCalledTimes(1)
  })

  it('falls back in-document when the host reload rejects', async () => {
    const locationReload = vi.spyOn(window.location, 'reload').mockImplementation(() => {
      window.dispatchEvent(new Event(ORCA_RENDERER_UNLOAD_PREVENTED_EVENT))
    })
    installHostBridge(() => Promise.reject(new Error('no host bridge')))

    await expect(requestLazyChunkRecoveryReload(window, async () => undefined)).resolves.toBe(
      'unload-vetoed'
    )

    expect(locationReload).toHaveBeenCalledTimes(1)
  })
})
