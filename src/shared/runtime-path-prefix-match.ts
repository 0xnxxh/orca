import { isWindowsAbsolutePathLike } from './cross-platform-path'

/**
 * Prefix matching for a path the user is still typing.
 *
 * Why this is not `normalizeRuntimePathForComparison`: that function infers path
 * flavor from the value it is given, which a half-typed prefix cannot supply.
 * `C`, `C:`, `//WSL.LOCALHOST` and a first separator are all valid partial
 * spellings of a real workspace whose own syntax proves nothing, so normalizing
 * the typed text alone blanks the list on exactly the rows the user is aiming at.
 * The candidate supplies the flavor instead, and both sides are then prepared the
 * same way and compared literally.
 */
export type RuntimePathPrefixKey = {
  /** Separator- and case-prepared candidate; a comparison key, never a real path. */
  path: string
  windows: boolean
  fold: RuntimePathFoldMode
}

/**
 * How much of a value folds case.
 *
 * `all` is a drive or plain UNC path; `wsl-head` folds only the share alias and
 * distro, because below the distro is a case-sensitive Linux filesystem; `none`
 * is POSIX, where folding would merge genuinely distinct files.
 */
type RuntimePathFoldMode = 'none' | 'all' | 'wsl-head'

const WSL_UNC_ALIAS = /^\/\/(?:wsl\.localhost|wsl\$)(?=\/|$)/i
const CANONICAL_WSL_UNC_ALIAS = '//wsl.localhost'

/** Build once per candidate; the fan-out prepares only the short typed prefix. */
export function prepareRuntimePathPrefixKey(candidatePath: string): RuntimePathPrefixKey {
  const windows = isWindowsAbsolutePathLike(candidatePath)
  const canonical = canonicalizeForPrefixMatch(candidatePath, windows)
  const fold: RuntimePathFoldMode = !windows
    ? 'none'
    : WSL_UNC_ALIAS.test(canonical)
      ? 'wsl-head'
      : 'all'
  return { path: foldForPrefixMatch(canonical, fold), windows, fold }
}

export function matchesRuntimePathPrefix(key: RuntimePathPrefixKey, typedPrefix: string): boolean {
  const prefix = foldForPrefixMatch(canonicalizeForPrefixMatch(typedPrefix, key.windows), key.fold)
  if (key.path.startsWith(prefix)) {
    return true
  }
  // Why: a trailing separator pins the prefix to a whole segment, so `/repo/`
  // never matches `/repository`. It should still match the pinned directory
  // itself, not only its descendants.
  const pinned = prefix.slice(0, -1)
  // Why the guard: a root prefix has no parent segment to pin to. Without it a
  // bare `//` would equal the POSIX root `/`, contradicting the canonicalizer's
  // deliberate treatment of a leading `//` as UNC syntax rather than a separator.
  return prefix.endsWith('/') && pinned.length > 0 && !pinned.endsWith('/') && key.path === pinned
}

function canonicalizeForPrefixMatch(value: string, windows: boolean): string {
  // Why NFD and not the NFC the equality helpers use: both give the same
  // canonical equivalence, but only NFD is prefix-preserving. Composing `e` +
  // U+0301 into `é` destroys the boundary of a prefix that stops at the `e`, so
  // an NFC key hides the row for `/repo/e` against `/repo/e` + U+0301 + `x`.
  // Decomposition never merges code points, so every prefix survives it.
  const decomposed = value.normalize('NFD')
  // Why: backslash is a legal POSIX filename character, including on SSH and
  // folder workspaces, so fold it only when the candidate proves Windows syntax.
  const separators = windows ? decomposed.replace(/\\/g, '/') : decomposed
  // Why the negative lookahead: a leading `//` is UNC syntax, not a doubled
  // separator, so only interior runs collapse.
  const collapsed = separators.replace(/(?!^)\/+/g, '/')
  return windows ? collapsed.replace(WSL_UNC_ALIAS, CANONICAL_WSL_UNC_ALIAS) : collapsed
}

/**
 * Why each value finds its own boundary instead of sharing a cached offset:
 * lowercasing can change length (U+0130 folds to two code units), so a boundary
 * measured on the candidate can land mid-segment in the prefix — which both hides
 * an equivalent distro spelling and folds a case-sensitive Linux name.
 */
function foldForPrefixMatch(canonical: string, fold: RuntimePathFoldMode): string {
  if (fold === 'none') {
    return canonical
  }
  if (fold === 'all') {
    return canonical.toLowerCase()
  }
  const headEnd = getWslCaseInsensitiveHeadEnd(canonical)
  return `${canonical.slice(0, headEnd).toLowerCase()}${canonical.slice(headEnd)}`
}

function getWslCaseInsensitiveHeadEnd(canonical: string): number {
  // Why: a prefix still inside the alias has no distro yet, so all of it folds.
  if (!WSL_UNC_ALIAS.test(canonical)) {
    return canonical.length
  }
  const distroEnd = canonical.indexOf('/', CANONICAL_WSL_UNC_ALIAS.length + 1)
  return distroEnd === -1 ? canonical.length : distroEnd
}
