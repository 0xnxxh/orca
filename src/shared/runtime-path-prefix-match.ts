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
  /** How far case folds: the whole value, or a WSL share+distro head. */
  foldLength: number
}

const WSL_UNC_ALIAS = /^\/\/(?:wsl\.localhost|wsl\$)(?=\/|$)/i
const CANONICAL_WSL_UNC_ALIAS = '//wsl.localhost'

/** Build once per candidate; the fan-out prepares only the short typed prefix. */
export function prepareRuntimePathPrefixKey(candidatePath: string): RuntimePathPrefixKey {
  const windows = isWindowsAbsolutePathLike(candidatePath)
  const canonical = canonicalizeForPrefixMatch(candidatePath, windows)
  const foldLength = getPrefixCaseFoldLength(canonical, windows)
  return { path: foldPrefixHead(canonical, foldLength), windows, foldLength }
}

export function matchesRuntimePathPrefix(key: RuntimePathPrefixKey, typedPrefix: string): boolean {
  const prefix = foldPrefixHead(
    canonicalizeForPrefixMatch(typedPrefix, key.windows),
    key.foldLength
  )
  if (key.path.startsWith(prefix)) {
    return true
  }
  // Why: a trailing separator pins the prefix to a whole segment, so `/repo/`
  // never matches `/repository`. It should still match the pinned directory
  // itself, not only its descendants.
  return prefix.endsWith('/') && key.path === prefix.slice(0, -1)
}

function canonicalizeForPrefixMatch(value: string, windows: boolean): string {
  const nfc = value.normalize('NFC')
  // Why: backslash is a legal POSIX filename character, including on SSH and
  // folder workspaces, so fold it only when the candidate proves Windows syntax.
  const separators = windows ? nfc.replace(/\\/g, '/') : nfc
  // Why the negative lookahead: a leading `//` is UNC syntax, not a doubled
  // separator, so only interior runs collapse.
  const collapsed = separators.replace(/(?!^)\/+/g, '/')
  return windows ? collapsed.replace(WSL_UNC_ALIAS, CANONICAL_WSL_UNC_ALIAS) : collapsed
}

// Why: Windows folds a drive or plain UNC path throughout, but a WSL UNC path
// folds only the share alias and distro — below that is a case-sensitive Linux
// filesystem, so folding further would merge genuinely distinct files.
function getPrefixCaseFoldLength(canonical: string, windows: boolean): number {
  if (!windows) {
    return 0
  }
  if (!WSL_UNC_ALIAS.test(canonical)) {
    return Number.POSITIVE_INFINITY
  }
  const distroEnd = canonical.indexOf('/', CANONICAL_WSL_UNC_ALIAS.length + 1)
  return distroEnd === -1 ? canonical.length : distroEnd
}

function foldPrefixHead(value: string, foldLength: number): string {
  if (foldLength === 0) {
    return value
  }
  return foldLength === Number.POSITIVE_INFINITY
    ? value.toLowerCase()
    : `${value.slice(0, foldLength).toLowerCase()}${value.slice(foldLength)}`
}
