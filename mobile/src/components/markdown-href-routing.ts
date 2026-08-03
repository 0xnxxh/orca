// Decides what a tapped markdown href should do on mobile: open the system
// browser/mail client, open a file in the worktree, or nothing. Mirrors the
// desktop native-chat contract where hrefs are explicit agent-authored links:
// file: URIs and scheme-less (relative or absolute) hrefs are file targets.
import { fileUriToFilesystemPath } from '../../../src/shared/file-uri-path'
import { isWindowsAbsolutePathLike } from '../../../src/shared/cross-platform-path'

export type MarkdownHrefRoute =
  | { kind: 'web'; url: string }
  | { kind: 'file'; pathText: string }
  | { kind: 'none' }

const WEB_SCHEME_PATTERN = /^(?:https?|mailto):/i
const SCHEME_PATTERN = /^[A-Za-z][A-Za-z0-9+.-]*:/

function parseLineFragment(hash: string): number | null {
  if (!hash) {
    return null
  }
  let decoded = hash
  try {
    decoded = decodeURIComponent(hash)
  } catch {
    // Keep the raw fragment when decoding fails.
  }
  const match = /^(?:L|line-?)([1-9]\d*)\b/i.exec(decoded)
  return match ? Number.parseInt(match[1]!, 10) : null
}

function stripQueryAndHash(value: string): { pathText: string; line: number | null } {
  const hashIndex = value.indexOf('#')
  const queryIndex = value.indexOf('?')
  const suffixIndex =
    hashIndex === -1 ? queryIndex : queryIndex === -1 ? hashIndex : Math.min(hashIndex, queryIndex)
  const pathText = suffixIndex === -1 ? value : value.slice(0, suffixIndex)
  const hash =
    hashIndex === -1
      ? ''
      : value.slice(hashIndex + 1, queryIndex > hashIndex ? queryIndex : undefined)
  return { pathText, line: parseLineFragment(hash) }
}

function maybeDecodeHrefPath(value: string): string {
  try {
    return decodeURIComponent(value)
  } catch {
    return value
  }
}

// The open flow parses a trailing :line back out via splitFilePathLineSuffix.
function withLineSuffix(pathText: string, line: number | null): string {
  return line === null ? pathText : `${pathText}:${line}`
}

export function routeMarkdownHref(href: string): MarkdownHrefRoute {
  const trimmed = href.trim()
  if (!trimmed || trimmed.startsWith('#')) {
    return { kind: 'none' }
  }
  if (WEB_SCHEME_PATTERN.test(trimmed)) {
    return { kind: 'web', url: trimmed }
  }
  if (/^file:/i.test(trimmed)) {
    let url: URL
    try {
      url = new URL(trimmed)
    } catch {
      return { kind: 'none' }
    }
    const filePath = fileUriToFilesystemPath(url)
    if (!filePath) {
      return { kind: 'none' }
    }
    return {
      kind: 'file',
      pathText: withLineSuffix(filePath, parseLineFragment(url.hash.slice(1)))
    }
  }
  // Other schemes (editor:, javascript:, data:, …) are dropped; a Windows drive
  // prefix only looks like a scheme.
  if (!isWindowsAbsolutePathLike(trimmed) && SCHEME_PATTERN.test(trimmed)) {
    return { kind: 'none' }
  }
  const { pathText, line } = stripQueryAndHash(trimmed)
  const decoded = maybeDecodeHrefPath(pathText)
  if (!decoded) {
    return { kind: 'none' }
  }
  return { kind: 'file', pathText: withLineSuffix(decoded, line) }
}
