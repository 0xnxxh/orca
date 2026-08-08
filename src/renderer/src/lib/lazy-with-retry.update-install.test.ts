// @vitest-environment happy-dom

// Reproduces the chunk failure that happens *during* a committed update install.
//
// Verified mechanism (2026-08-07, isolated Orca build, CDP): the renderer reads
// its 778 lazy chunks by byte offset out of a single app.asar. Once the installer
// replaces that archive, the old offsets land inside a different file, so an
// import that succeeded a moment earlier returns unparseable JavaScript:
//   before swap  -> LOADED_OK
//   after swap   -> SyntaxError: Unexpected token '}'   (also ':', 'Unexpected string')
//   name changed -> TypeError: Failed to fetch dynamically imported module
// Those are the exact messages in the shipped reports, and `overlay.update-card`
// — the surface hosting the restart button — is one of the failing boundaries.
//
// Requesting a recovery reload in that window is worse than useless: the process
// is already being torn down and the bundle underneath it has been swapped.

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { ORCA_UPDATER_QUIT_AND_INSTALL_STARTED_EVENT } from '../../../shared/updater-renderer-events'
import { registerUpdaterBeforeUnloadBypass } from './updater-beforeunload'
import {
  isLazyChunkLoadError,
  loadLazyWithRetry,
  resetLazyChunkReloadRequestsForTest
} from './lazy-with-retry'

const RELOAD_GUARD_KEY = 'orca:lazy-chunk-reload-attempted'

// The dominant crash-time message across the shipped bundles.
const CORRUPT_CHUNK_ERROR = (): SyntaxError => new SyntaxError("Unexpected token '}'")

type Breadcrumb = { name: string; data: Record<string, unknown> }

function installBreadcrumbSink(): Breadcrumb[] {
  const breadcrumbs: Breadcrumb[] = []
  ;(window as unknown as { api: unknown }).api = {
    crashReports: {
      recordBreadcrumb: (crumb: Breadcrumb) => {
        breadcrumbs.push(crumb)
      }
    }
  }
  return breadcrumbs
}

describe('loadLazyWithRetry during a committed update install', () => {
  let unregister: (() => void) | null = null

  beforeEach(() => {
    window.sessionStorage.clear()
    resetLazyChunkReloadRequestsForTest()
    vi.spyOn(window.location, 'reload').mockImplementation(() => undefined)
    unregister = registerUpdaterBeforeUnloadBypass()
  })

  afterEach(() => {
    unregister?.()
    unregister = null
    vi.restoreAllMocks()
    window.sessionStorage.clear()
    resetLazyChunkReloadRequestsForTest()
    delete (window as unknown as { api?: unknown }).api
  })

  const commitUpdateInstall = (): void => {
    window.dispatchEvent(new Event(ORCA_UPDATER_QUIT_AND_INSTALL_STARTED_EVENT))
  }

  it('does not request a recovery reload once the installer is committed', async () => {
    installBreadcrumbSink()
    commitUpdateInstall()

    await expect(
      loadLazyWithRetry(() => Promise.reject(CORRUPT_CHUNK_ERROR()), {
        retries: 0,
        reloadKey: 'overlay.update-card'
      })
    ).rejects.toSatisfy(isLazyChunkLoadError)

    expect(window.location.reload).not.toHaveBeenCalled()
  })

  it('contains the failure so the boundary suppresses it instead of filing a crash', async () => {
    installBreadcrumbSink()
    commitUpdateInstall()

    const error = await loadLazyWithRetry(() => Promise.reject(CORRUPT_CHUNK_ERROR()), {
      retries: 0,
      reloadKey: 'overlay.update-card'
    }).catch((e: unknown) => e)

    expect(isLazyChunkLoadError(error)).toBe(true)
  })

  it('records why recovery was skipped, naming the call site', async () => {
    const breadcrumbs = installBreadcrumbSink()
    commitUpdateInstall()

    await loadLazyWithRetry(() => Promise.reject(CORRUPT_CHUNK_ERROR()), {
      retries: 0,
      reloadKey: 'overlay.update-card'
    }).catch(() => undefined)

    const skipped = breadcrumbs.find((crumb) => crumb.name === 'lazy_chunk_reload_skipped')
    expect(skipped?.data.reloadKey).toBe('overlay.update-card')
    expect(skipped?.data.outcome).toBe('update-install-in-progress')
  })

  it('leaves no reload guard behind, so a later real failure can still recover', async () => {
    installBreadcrumbSink()
    commitUpdateInstall()

    await loadLazyWithRetry(() => Promise.reject(CORRUPT_CHUNK_ERROR()), {
      retries: 0,
      reloadKey: 'overlay.update-card'
    }).catch(() => undefined)

    expect(window.sessionStorage.getItem(RELOAD_GUARD_KEY)).toBeNull()
  })

  it('still requests recovery when no install is committed', async () => {
    installBreadcrumbSink()

    await loadLazyWithRetry(() => Promise.reject(CORRUPT_CHUNK_ERROR()), {
      retries: 0,
      reloadKey: 'right-sidebar'
    }).catch(() => undefined)

    // Positive control: the ordinary recovery path must stay alive, or this fix
    // would silently disable chunk recovery everywhere.
    expect(window.location.reload).toHaveBeenCalled()
  })
})
