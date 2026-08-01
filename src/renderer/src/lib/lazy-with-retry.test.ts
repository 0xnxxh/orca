// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { ComponentType } from 'react'

import { isLazyChunkLoadError, loadLazyWithRetry } from './lazy-with-retry'

const RELOAD_GUARD_KEY = 'orca:lazy-chunk-reload-attempted'
// A guard holding a *different* document's token is the only proof the reload
// landed; a token matching this document means the reload was vetoed.
const LANDED_RELOAD_GUARD_VALUE = 'doc-before-the-reload'
const Comp: ComponentType = () => null
const chunkParseError = (): SyntaxError => new SyntaxError("Unexpected token ']'")
const chunkFetchError = (): TypeError =>
  new TypeError('Failed to fetch dynamically imported module: file://redacted/chunk.js')

function spyOnReload(): ReturnType<typeof vi.fn> {
  const reload = vi.fn()
  // happy-dom's location.reload is a no-op that would otherwise log; replace it.
  vi.spyOn(window.location, 'reload').mockImplementation(reload)
  return reload
}

function stubCrashReportsBreadcrumb(): ReturnType<typeof vi.fn> {
  const recordBreadcrumb = vi.fn()
  Object.assign(window, { api: { crashReports: { recordBreadcrumb } } })
  return recordBreadcrumb
}

// Why: happy-dom's Storage is a Proxy that vi.spyOn cannot reliably restore, so
// override window.sessionStorage with a throwing getter and restore the saved
// descriptor in afterEach.
let savedSessionStorageDescriptor: PropertyDescriptor | undefined

function makeSessionStorageThrow(): void {
  savedSessionStorageDescriptor = Object.getOwnPropertyDescriptor(window, 'sessionStorage')
  Object.defineProperty(window, 'sessionStorage', {
    configurable: true,
    get() {
      throw new Error('storage blocked')
    }
  })
}

beforeEach(() => {
  vi.useFakeTimers()
  window.sessionStorage.clear()
})

afterEach(() => {
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
  vi.useRealTimers()
  if (savedSessionStorageDescriptor) {
    Object.defineProperty(window, 'sessionStorage', savedSessionStorageDescriptor)
    savedSessionStorageDescriptor = undefined
  }
  try {
    delete (window as unknown as { api?: unknown }).api
    window.sessionStorage.clear()
  } catch {
    // ignore — environment without storage
  }
})

describe('loadLazyWithRetry', () => {
  it('retries with exponential backoff (250ms, 500ms) and then resolves', async () => {
    const reload = spyOnReload()
    const factory = vi
      .fn()
      .mockRejectedValueOnce(chunkParseError())
      .mockRejectedValueOnce(chunkParseError())
      .mockResolvedValueOnce({ default: Comp })

    const loaded = loadLazyWithRetry(factory, { retries: 2, baseDelayMs: 250 })
    expect(factory).toHaveBeenCalledTimes(1) // first attempt runs synchronously

    await vi.advanceTimersByTimeAsync(200)
    expect(factory).toHaveBeenCalledTimes(1) // still inside the 250ms backoff
    await vi.advanceTimersByTimeAsync(100)
    expect(factory).toHaveBeenCalledTimes(2) // 250ms elapsed -> 2nd attempt

    await vi.advanceTimersByTimeAsync(400)
    expect(factory).toHaveBeenCalledTimes(2) // still inside the 500ms backoff
    await vi.advanceTimersByTimeAsync(100)
    expect(factory).toHaveBeenCalledTimes(3) // 500ms elapsed -> 3rd attempt

    await expect(loaded).resolves.toEqual({ default: Comp })
    expect(reload).not.toHaveBeenCalled()
  })

  it('performs exactly one guarded reload after retries are exhausted', async () => {
    const reload = spyOnReload()
    const factory = vi.fn(() => Promise.reject(chunkParseError()))

    const loaded = loadLazyWithRetry(factory, { retries: 2, baseDelayMs: 250 })
    let settled = false
    void loaded.then(
      () => {
        settled = true
      },
      () => {
        settled = true
      }
    )
    await vi.advanceTimersByTimeAsync(5000)

    expect(factory).toHaveBeenCalledTimes(3)
    expect(reload).toHaveBeenCalledTimes(1)
    // The guard stores the requesting document's identity, not a bare flag.
    expect(window.sessionStorage.getItem(RELOAD_GUARD_KEY)).toBe(String(performance.timeOrigin))
    // The load promise must stay pending across the reload window, so the error
    // boundary never flashes ahead of the navigation.
    expect(settled).toBe(false)
  })

  // Crash b860def2: reload() was called at 19:05 and the document was still alive at
  // 19:49 (no renderer bootstrap in between), so the requesting pane suspended forever.
  it('surfaces the original error when the guarded reload never tears the document down', async () => {
    const reload = spyOnReload()
    stubCrashReportsBreadcrumb()
    const error = chunkParseError()
    const factory = vi.fn(() => Promise.reject(error))

    const loaded = loadLazyWithRetry(factory, { retries: 0 })
    let settled: unknown = 'pending'
    void loaded.then(
      (value) => {
        settled = value
      },
      (rejection) => {
        settled = rejection
      }
    )

    await vi.advanceTimersByTimeAsync(5000)
    expect(reload).toHaveBeenCalledTimes(1)
    // Still suspended inside the grace window, so a landed reload shows no fallback.
    expect(settled).toBe('pending')

    await vi.advanceTimersByTimeAsync(10_000)
    expect(settled).toBe(error)
    expect(reload).toHaveBeenCalledTimes(1)
  })

  it('does NOT reload twice — wraps known chunk failures once the guard is already set', async () => {
    const reload = spyOnReload()
    window.sessionStorage.setItem(RELOAD_GUARD_KEY, LANDED_RELOAD_GUARD_VALUE)
    const error = chunkFetchError()
    const factory = vi.fn(() => Promise.reject(error))

    const loaded = loadLazyWithRetry(factory, { retries: 2, baseDelayMs: 250 })
    const assertion = expect(loaded).rejects.toMatchObject({
      name: 'LazyChunkLoadError',
      cause: error
    })
    await vi.advanceTimersByTimeAsync(5000)
    await assertion

    expect(reload).not.toHaveBeenCalled()
    const caught = await loaded.catch((rejection) => rejection)
    expect(isLazyChunkLoadError(caught)).toBe(true)
  })

  // Crash b860def2: the guarded reload() was vetoed, the document lived on for 44
  // minutes, and the still-set guard turned the next failure into the sentinel that
  // error boundaries suppress — hiding a recovery that never ran.
  it('reports the original error when the guard belongs to this same document (reload vetoed)', async () => {
    const reload = spyOnReload()
    window.sessionStorage.setItem(RELOAD_GUARD_KEY, String(performance.timeOrigin))
    const error = chunkParseError()
    const factory = vi.fn(() => Promise.reject(error))

    const loaded = loadLazyWithRetry(factory, { retries: 0 })
    const assertion = expect(loaded).rejects.toBe(error)
    await vi.advanceTimersByTimeAsync(5000)
    await assertion

    // Re-arming the reload here would loop against whatever vetoed the first one.
    expect(reload).not.toHaveBeenCalled()
    const caught = await loaded.catch((rejection) => rejection)
    expect(isLazyChunkLoadError(caught)).toBe(false)
  })

  it('preserves the original error when the guarded failure is not a dynamic import failure', async () => {
    const reload = spyOnReload()
    window.sessionStorage.setItem(RELOAD_GUARD_KEY, LANDED_RELOAD_GUARD_VALUE)
    const error = new Error('render bug from lazy module evaluation')
    const factory = vi.fn(() => Promise.reject(error))

    const loaded = loadLazyWithRetry(factory, { retries: 1, baseDelayMs: 100 })
    const assertion = expect(loaded).rejects.toBe(error)
    await vi.advanceTimersByTimeAsync(5000)
    await assertion

    expect(reload).not.toHaveBeenCalled()
    const caught = await loaded.catch((rejection) => rejection)
    expect(isLazyChunkLoadError(caught)).toBe(false)
  })

  it('recovers a parse error after the reload guard is set (corrupt chunk = recoverable)', async () => {
    // A native SyntaxError reaching loadLazyWithRetry's catch comes from the
    // chunk's parse phase — a stale/truncated/corrupt chunk — so after the one
    // guarded reload it must be wrapped as a recoverable LazyChunkLoadError
    // rather than re-thrown raw to the boundary (where Retry just re-runs the
    // same dead import). Regression guard for crash report e08749bb (right
    // sidebar, "Unexpected token ')'").
    const reload = spyOnReload()
    window.sessionStorage.setItem(RELOAD_GUARD_KEY, LANDED_RELOAD_GUARD_VALUE)
    const error = chunkParseError()
    const factory = vi.fn(() => Promise.reject(error))

    const loaded = loadLazyWithRetry(factory, { retries: 1, baseDelayMs: 100 })
    const settled = loaded.then(
      () => null,
      (rejection: unknown) => rejection
    )
    await vi.advanceTimersByTimeAsync(5000)
    const caught = await settled

    expect(reload).not.toHaveBeenCalled()
    expect(isLazyChunkLoadError(caught)).toBe(true)
  })

  it('preserves ordinary (non-parse) module evaluation errors so real bugs still report', async () => {
    // An ordinary Error from a lazy module is a genuine evaluation bug, not a
    // corrupt chunk; it must still surface raw after the guard is set.
    const reload = spyOnReload()
    window.sessionStorage.setItem(RELOAD_GUARD_KEY, LANDED_RELOAD_GUARD_VALUE)
    const error = new Error('render bug from lazy module evaluation')
    const factory = vi.fn(() => Promise.reject(error))

    const loaded = loadLazyWithRetry(factory, { retries: 1, baseDelayMs: 100 })
    const assertion = expect(loaded).rejects.toBe(error)
    await vi.advanceTimersByTimeAsync(5000)
    await assertion

    expect(reload).not.toHaveBeenCalled()
    const caught = await loaded.catch((rejection) => rejection)
    expect(isLazyChunkLoadError(caught)).toBe(false)
  })

  it('fails closed with the original error when sessionStorage reads throw', async () => {
    const reload = spyOnReload()
    // Private-mode / sandboxed storage makes reads throw. The guard must treat
    // this as "already reloaded" so a broken chunk can NEVER cause a reload loop.
    makeSessionStorageThrow()
    const error = chunkParseError()
    const factory = vi.fn(() => Promise.reject(error))

    const loaded = loadLazyWithRetry(factory, { retries: 1, baseDelayMs: 100 })
    const assertion = expect(loaded).rejects.toBe(error)
    await vi.advanceTimersByTimeAsync(5000)
    await assertion

    expect(reload).not.toHaveBeenCalled()
    const caught = await loaded.catch((rejection) => rejection)
    expect(isLazyChunkLoadError(caught)).toBe(false)
  })

  it('records a lazy_chunk_reload breadcrumb (with reloadKey) before reloading', async () => {
    const reload = spyOnReload()
    const recordBreadcrumb = stubCrashReportsBreadcrumb()
    const factory = vi.fn(() => Promise.reject(chunkParseError()))

    const loaded = loadLazyWithRetry(factory, { retries: 0, reloadKey: 'right-sidebar' })
    let settled = false
    void loaded.then(
      () => {
        settled = true
      },
      () => {
        settled = true
      }
    )
    await vi.advanceTimersByTimeAsync(5000)

    expect(recordBreadcrumb).toHaveBeenCalledTimes(1)
    expect(recordBreadcrumb).toHaveBeenCalledWith({
      name: 'lazy_chunk_reload',
      data: { reloadKey: 'right-sidebar', message: "Unexpected token ']'" }
    })
    // The breadcrumb must land before window.location.reload() tears the page down.
    expect(recordBreadcrumb.mock.invocationCallOrder[0]).toBeLessThan(
      reload.mock.invocationCallOrder[0]
    )
    expect(settled).toBe(false)
  })

  it('re-throws the original error without reloading when there is no window (SSR / node)', async () => {
    vi.stubGlobal('window', undefined)
    const error = chunkParseError()
    const factory = vi.fn(() => Promise.reject(error))

    const loaded = loadLazyWithRetry(factory, { retries: 1, baseDelayMs: 100 })
    const assertion = expect(loaded).rejects.toBe(error)
    await vi.advanceTimersByTimeAsync(5000)
    await assertion

    expect(factory).toHaveBeenCalledTimes(2)
    const caught = await loaded.catch((rejection) => rejection)
    expect(isLazyChunkLoadError(caught)).toBe(false)
  })

  it('keeps the reload guard set across a successful load (no second reload in one session)', async () => {
    const reload = spyOnReload()
    window.sessionStorage.setItem(RELOAD_GUARD_KEY, LANDED_RELOAD_GUARD_VALUE)
    const factory = vi.fn(() => Promise.resolve({ default: Comp }))

    await loadLazyWithRetry(factory)

    // The guard must survive a healthy load — otherwise a sibling chunk's success
    // would re-arm the reload and an auto-mounted corrupt chunk would loop.
    expect(window.sessionStorage.getItem(RELOAD_GUARD_KEY)).toBe(LANDED_RELOAD_GUARD_VALUE)
    expect(reload).not.toHaveBeenCalled()
  })
})
