import type { Repo } from '../../../../shared/types'
import { getRepoHostIdentity } from './repo-host-identity'

// Why: after a drag-reorder we optimistically set `repos`, persist, and main
// broadcasts `repos:changed`. The renderer's own echo handler refetches, which
// would otherwise hand back field-identical repos as brand-new objects. New
// identities invalidate the repoMap/repoOrder/rows memos and force the
// virtualizer to rebuild + re-measure a tick after the drop — the visible jump.
// Reusing equal objects (and the whole array when nothing moved) makes the echo
// a no-op render.
// Why: `Repo` carries nested records (hookSettings, upstream, gitRemoteIdentity, repoIcon, path
// arrays). IPC structured-clone rebuilds those every fetch, and main's hydrateRepo always
// reconstructs hookSettings — so a reference compare reports every repo as changed and no repo
// ever reconciles. Compare nested plain values structurally; they are small sanitized records.
function areValuesEqual(a: unknown, b: unknown): boolean {
  if (a === b) {
    return true
  }
  if (typeof a !== 'object' || typeof b !== 'object' || a === null || b === null) {
    return false
  }
  if (Array.isArray(a) || Array.isArray(b)) {
    return (
      Array.isArray(a) &&
      Array.isArray(b) &&
      a.length === b.length &&
      a.every((item, index) => areValuesEqual(item, b[index]))
    )
  }
  // Why: only plain records are safe to walk — anything exotic falls back to reference equality.
  if (
    Object.getPrototypeOf(a) !== Object.prototype ||
    Object.getPrototypeOf(b) !== Object.prototype
  ) {
    return false
  }
  const aRecord = a as Record<string, unknown>
  const bRecord = b as Record<string, unknown>
  const keys = Object.keys(aRecord)
  if (keys.length !== Object.keys(bRecord).length) {
    return false
  }
  return keys.every(
    (key) =>
      Object.prototype.hasOwnProperty.call(bRecord, key) &&
      areValuesEqual(aRecord[key], bRecord[key])
  )
}

// Why: own-key-count equality distinguishes an absent optional key from one present-and-undefined,
// which callers rely on to detect a cleared field (e.g. a dropped runtime preference).
function areEntriesEqual<T extends object>(a: T, b: T): boolean {
  if (a === b) {
    return true
  }
  const keys = Object.keys(a) as (keyof T)[]
  if (keys.length !== Object.keys(b).length) {
    return false
  }
  for (const key of keys) {
    if (!Object.prototype.hasOwnProperty.call(b, key)) {
      return false
    }
    if (!areValuesEqual(a[key], b[key])) {
      return false
    }
  }
  return true
}

/**
 * Reuses equal entries from `previous` — and the whole array when nothing moved — so a refetch
 * that changed nothing leaves identity-keyed memos and store subscribers untouched.
 */
export function reconcileFetchedEntries<T extends object>(
  previous: readonly T[],
  next: readonly T[],
  getIdentity: (entry: T) => string
): readonly T[] {
  const previousByIdentity = new Map(previous.map((entry) => [getIdentity(entry), entry]))
  let identical = next.length === previous.length
  const reconciled = next.map((entry, index) => {
    const existing = previousByIdentity.get(getIdentity(entry))
    if (existing && areEntriesEqual(existing, entry)) {
      if (existing !== previous[index]) {
        identical = false
      }
      return existing
    }
    identical = false
    return entry
  })
  return identical ? previous : reconciled
}

export function reconcileFetchedRepos(
  previous: readonly Repo[],
  next: readonly Repo[]
): readonly Repo[] {
  return reconcileFetchedEntries(previous, next, getRepoHostIdentity)
}
