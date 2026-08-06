import { lazy, type ComponentType, type LazyExoticComponent } from 'react'

import {
  requestLazyChunkRecoveryReload,
  type LazyChunkRecoveryReloadOutcome
} from './lazy-chunk-recovery-reload'

/**
 * Resilient replacement for React.lazy.
 *
 * Why: a stale, corrupt, or truncated lazy chunk parses as invalid JavaScript and
 * rejects its dynamic import() with a native SyntaxError (e.g. "Unexpected token
 * ']'"). React.lazy permanently caches that rejection, so the error boundary's
 * "Retry" — which just re-renders the same Lazy — can never recover it; the
 * surface stays dead and reports a react-error-boundary crash. This wrapper first
 * retries transient failures, then requests one restart-prepared reload before
 * falling through to the error boundary.
 */

// eslint-disable-next-line @typescript-eslint/no-explicit-any -- mirror React.lazy's own ComponentType<any> constraint so every existing call site type-checks unchanged.
type AnyComponent = ComponentType<any>

type LazyFactory<T extends AnyComponent> = () => Promise<{ default: T }>

type ReloadGuardState = 'not-attempted' | 'reload-landed' | 'reload-not-landed' | 'unavailable'

export type LazyWithRetryOptions = {
  retries?: number
  baseDelayMs?: number
  /** Names the call site on the reload breadcrumbs and on LazyChunkLoadError; never control flow. */
  reloadKey?: string
}

export class LazyChunkLoadError extends Error {
  /** Which lazy call site failed; carried on the error so reports name it without a breadcrumb. */
  readonly reloadKey: string

  constructor(cause: unknown, reloadKey = 'unknown') {
    super('Lazy chunk load failed after reload recovery was exhausted')
    this.name = 'LazyChunkLoadError'
    this.reloadKey = reloadKey
    ;(this as { cause?: unknown }).cause = cause
  }
}

export function isLazyChunkLoadError(error: unknown): error is LazyChunkLoadError {
  return error instanceof LazyChunkLoadError
}

// The session guard survives a landed reload to prevent loops, but a surviving
// document clears its own token so a later failure can retry recovery.
const RELOAD_GUARD_KEY = 'orca:lazy-chunk-reload-attempted'
// Reloading reevaluates this fallback, giving the new document a different token.
const FALLBACK_RELOAD_TOKEN = `doc-${Math.random().toString(36).slice(2)}`
const DEFAULT_RETRIES = 2
const DEFAULT_BASE_DELAY_MS = 250

// A matching token proves this document requested a reload that never landed.
function currentDocumentReloadToken(): string {
  const timeOrigin = typeof performance === 'undefined' ? Number.NaN : performance.timeOrigin
  return Number.isFinite(timeOrigin) && timeOrigin > 0 ? String(timeOrigin) : FALLBACK_RELOAD_TOKEN
}

function readChunkReloadGuardState(): ReloadGuardState {
  if (typeof window === 'undefined') {
    return 'unavailable'
  }
  try {
    const stored = window.sessionStorage.getItem(RELOAD_GUARD_KEY)
    if (stored === null) {
      return 'not-attempted'
    }
    return stored === currentDocumentReloadToken() ? 'reload-not-landed' : 'reload-landed'
  } catch {
    // Why: when storage is blocked we cannot prove a reload happened, but still
    // fail closed on reloads so a broken chunk never loops.
    return 'unavailable'
  }
}

function markChunkReloadAttempted(): boolean {
  try {
    window.sessionStorage.setItem(RELOAD_GUARD_KEY, currentDocumentReloadToken())
    return true
  } catch {
    // A reload without a durable guard can loop, so treat write failure as unavailable.
    return false
  }
}

function clearChunkReloadGuard(): void {
  try {
    window.sessionStorage.removeItem(RELOAD_GUARD_KEY)
  } catch {
    // Best effort: a document that cannot clear the guard just forfeits its retry.
  }
}

// A per-document cap prevents repeated vetoes from creating a reload loop.
const MAX_RELOAD_REQUESTS_PER_DOCUMENT = 2
let reloadRequestsThisDocument = 0
let reloadRequestInFlight = false
// One breadcrumb per reloadKey + outcome + error name (unkeyed call sites share
// 'unknown'): a corrupt shared chunk can fail dozens of sibling imports at once,
// which would otherwise flush the 30-entry breadcrumb ring.
const MAX_RECORDED_EXHAUSTION_KEYS = 128
const recordedExhaustionKeys = new Set<string>()

export function resetLazyChunkReloadRequestsForTest(): void {
  reloadRequestsThisDocument = 0
  reloadRequestInFlight = false
  recordedExhaustionKeys.clear()
}

type ReloadBreadcrumbName =
  | 'lazy_chunk_reload'
  | 'lazy_chunk_reload_vetoed'
  | 'lazy_chunk_recovery_exhausted'

function recordReloadBreadcrumb(
  name: ReloadBreadcrumbName,
  reloadKey: string,
  message: string,
  outcome?: string
): void {
  // Inlined rather than importing crash-diagnostics so this low-level recovery
  // primitive stays free of the renderer/webview module graph (keeps it SSR- and
  // unit-test-friendly). Mirrors crash-diagnostics' best-effort breadcrumb call.
  try {
    const api = (window as Window & { api?: Window['api'] }).api
    api?.crashReports.recordBreadcrumb({
      name,
      data: { reloadKey, message, ...(outcome === undefined ? {} : { outcome }) }
    })
  } catch {
    // Crash evidence is best-effort and must never mask the original failure.
  }
}

const wait = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms))

/**
 * Names a corrupt-chunk failure that recovery can no longer act on, so the error
 * boundary contains it instead of filing a react-error-boundary crash. Genuine
 * logic bugs are not dynamic-import failures and stay raw so they keep reporting.
 */
function exhaustedRecoveryFailure(
  lastError: unknown,
  reloadKey: string,
  failureMessage: string,
  outcome: string,
  // Set when the caller already recorded a vetoed breadcrumb for this outcome;
  // the 30-entry ring is the only diagnostic left, so it must not self-evict.
  alreadyRecorded = false
): unknown {
  if (!isKnownDynamicImportFailure(lastError)) {
    return lastError
  }
  const failureName = lastError instanceof Error ? lastError.name : 'unknown'
  const crumbKey = `${reloadKey}:${outcome}:${failureName}`
  if (!alreadyRecorded && !recordedExhaustionKeys.has(crumbKey)) {
    // error.name is library-controlled, so bound the set the way the breadcrumb
    // and renderer-error key stores do: evict oldest-first, never wholesale, so
    // an overflow cannot re-open the whole set to a repeat burst.
    while (recordedExhaustionKeys.size >= MAX_RECORDED_EXHAUSTION_KEYS) {
      const oldestKey = recordedExhaustionKeys.values().next().value
      if (oldestKey === undefined) {
        break
      }
      recordedExhaustionKeys.delete(oldestKey)
    }
    recordedExhaustionKeys.add(crumbKey)
    recordReloadBreadcrumb('lazy_chunk_recovery_exhausted', reloadKey, failureMessage, outcome)
  }
  return new LazyChunkLoadError(lastError, reloadKey)
}

// Module scope: re-evaluating these literals would allocate fresh RegExp objects
// on every classification.
const DYNAMIC_IMPORT_FAILURE_PATTERNS = [
  /failed to fetch dynamically imported module/i,
  /error loading dynamically imported module/i,
  /importing a module script failed/i,
  /failed to load module script/i,
  /loading chunk .+ failed/i,
  /unexpected token/i,
  /unexpected end of (input|script|json)/i
]

function isKnownDynamicImportFailure(error: unknown): boolean {
  if (!(error instanceof Error)) {
    return false
  }

  if (error.name === 'ChunkLoadError') {
    return true
  }

  // Why: a stale/truncated/corrupt chunk parses as invalid JS, so import()
  // rejects with a native SyntaxError ("Unexpected token '}'", "Unexpected
  // string", "Illegal return statement", …  — all four observed in shipped
  // reports). That reaches this catch only from the chunk's fetch+parse phase.
  // Trade-off: a SyntaxError thrown while *evaluating* a lazily imported module
  // (e.g. a top-level JSON.parse) is indistinguishable here by message, so it is
  // contained too. Stack-frame discrimination was tried and rejected: parser
  // errors carry no frames today, but that is not guaranteed across V8 versions
  // and a false negative silently restores the crash this guards against.
  if (error.name === 'SyntaxError') {
    return true
  }

  return DYNAMIC_IMPORT_FAILURE_PATTERNS.some((pattern) => pattern.test(error.message))
}

export async function loadLazyWithRetry<T extends AnyComponent>(
  factory: LazyFactory<T>,
  options: LazyWithRetryOptions = {}
): Promise<{ default: T }> {
  const retries = options.retries ?? DEFAULT_RETRIES
  const baseDelayMs = options.baseDelayMs ?? DEFAULT_BASE_DELAY_MS

  let lastError: unknown
  for (let attempt = 0; attempt <= retries; attempt += 1) {
    try {
      return await factory()
    } catch (error) {
      lastError = error
      if (attempt < retries) {
        // Exponential backoff absorbs transient fetch hiccups (HTTP / relay / SSH).
        await wait(baseDelayMs * 2 ** attempt)
      }
    }
  }

  const reloadKey = options.reloadKey ?? 'unknown'
  const failureMessage = lastError instanceof Error ? lastError.message : String(lastError)
  const reloadGuardState = readChunkReloadGuardState()

  if (
    typeof window !== 'undefined' &&
    reloadGuardState === 'not-attempted' &&
    reloadRequestsThisDocument < MAX_RELOAD_REQUESTS_PER_DOCUMENT
  ) {
    if (!markChunkReloadAttempted()) {
      // No recovery was attempted, so keep normal reporting rather than containing.
      throw lastError
    }
    reloadRequestsThisDocument += 1
    reloadRequestInFlight = true
    recordReloadBreadcrumb('lazy_chunk_reload', reloadKey, failureMessage)
    let outcome: LazyChunkRecoveryReloadOutcome = 'request-failed'
    try {
      // A landed reload tears down this document before the promise settles.
      outcome = await requestLazyChunkRecoveryReload(window)
    } finally {
      reloadRequestInFlight = false
      clearChunkReloadGuard()
      recordReloadBreadcrumb('lazy_chunk_reload_vetoed', reloadKey, failureMessage, outcome)
    }
    // The reload was this document's last recovery step for this chunk, whether it
    // was refused outright or simply never navigated.
    throw exhaustedRecoveryFailure(lastError, reloadKey, failureMessage, outcome, true)
  }

  if (reloadGuardState === 'reload-landed') {
    throw exhaustedRecoveryFailure(lastError, reloadKey, failureMessage, 'reload-landed')
  }

  if (reloadGuardState === 'reload-not-landed') {
    if (reloadRequestInFlight) {
      // A sibling chunk failing under a pending reload cannot request its own.
      throw exhaustedRecoveryFailure(lastError, reloadKey, failureMessage, 'reload-in-flight')
    }
    if (!isKnownDynamicImportFailure(lastError)) {
      // An unrelated failure must not clear a guard it did not set.
      throw lastError
    }
    // Record the veto beside the resulting report before the ring can evict it.
    clearChunkReloadGuard()
    recordReloadBreadcrumb(
      'lazy_chunk_reload_vetoed',
      reloadKey,
      failureMessage,
      'guard-not-landed'
    )
    throw exhaustedRecoveryFailure(lastError, reloadKey, failureMessage, 'guard-not-landed', true)
  }

  if (reloadGuardState === 'not-attempted') {
    // The per-document reload cap is spent; further failures cannot recover.
    throw exhaustedRecoveryFailure(lastError, reloadKey, failureMessage, 'reload-cap-reached')
  }

  // No window or no usable storage: recovery was never attempted, so preserve
  // normal error reporting instead of containing a failure we never acted on.
  throw lastError
}

export function lazyWithRetry<T extends AnyComponent>(
  factory: LazyFactory<T>,
  options?: LazyWithRetryOptions
): LazyExoticComponent<T> {
  return lazy(() => loadLazyWithRetry(factory, options))
}
