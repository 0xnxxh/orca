// @vitest-environment happy-dom
import { afterEach, describe, expect, it } from 'vitest'

import { installWebPreloadApi } from './web-preload-api'

describe('web build updater install commitment', () => {
  afterEach(() => {
    delete (window as unknown as { api?: unknown }).api
  })

  it('never claims an install is committed', async () => {
    // The web build serves chunks over HTTP from a running server; no installer
    // ever swaps an archive underneath it, so chunk recovery must stay enabled.
    installWebPreloadApi()
    const updater = (window as unknown as { api: { updater: PreloadUpdater } }).api.updater

    await expect(updater.isInstallCommitted()).resolves.toBe(false)
    expect(updater.onInstallCommitted(() => undefined)).toBeTypeOf('function')
  })
})

type PreloadUpdater = {
  isInstallCommitted: () => Promise<boolean>
  onInstallCommitted: (cb: (committed: boolean) => void) => () => void
}
