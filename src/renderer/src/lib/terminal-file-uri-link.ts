import { resolveTerminalFileUrlTarget } from '../../../shared/terminal-file-url-target'
import type { ParsedTerminalFileLink } from './terminal-links'

// Plain-text `file://` URIs printed to a terminal (e.g. `ls --hyperlink` output
// rendered literally, or a tool echoing a report path) are neither http links
// nor bare filesystem paths, so the URL and local-path detectors both skip
// them. This pass claims those spans and decodes them to a filesystem path via
// the same resolver used for OSC 8 file hyperlinks, so a printed `file://` opens
// identically whether or not the emitter wrapped it in an escape sequence.

// A URI cannot contain raw whitespace; stop at the delimiters that never begin a
// path segment. Mirrors the terminator set the http URL detector uses so the two
// schemes trim consistently.
const FILE_URI_REGEX = /\bfile:\/\/[^\s"'`<>|(){}[\]]+/gi

// Trailing punctuation that is prose, not part of the path. Line/column suffixes
// end in a digit and extensions end in a letter, so trimming these is safe.
const TRAILING_PROSE_CHARS = new Set([
  '.',
  ',',
  ';',
  ':',
  '!',
  '?',
  ')',
  ']',
  '}',
  '>',
  '"',
  "'",
  '`'
])

function trimTrailingProse(uriText: string): string {
  let end = uriText.length
  while (end > 0 && TRAILING_PROSE_CHARS.has(uriText[end - 1])) {
    end -= 1
  }
  return uriText.slice(0, end)
}

// Remote hosts are rejected: on a local pane a hostname'd URI would resolve to a
// path that does not exist, and the provider's existence probe would drop it
// anyway. Windows UNC support stays with the OSC path, which has the platform
// context this pure pass deliberately avoids.
function toFileUriLink(uriText: string, startIndex: number): ParsedTerminalFileLink | null {
  let url: URL
  try {
    url = new URL(uriText)
  } catch {
    return null
  }
  const target = resolveTerminalFileUrlTarget(url)
  if (!target) {
    return null
  }
  return {
    pathText: target.filePath,
    line: target.line,
    column: target.column,
    startIndex,
    endIndex: startIndex + uriText.length,
    displayText: uriText
  }
}

export function detectTerminalFileUriLinks(lineText: string): ParsedTerminalFileLink[] {
  const links: ParsedTerminalFileLink[] = []
  for (const match of lineText.matchAll(FILE_URI_REGEX)) {
    const startIndex = match.index ?? 0
    const trimmed = trimTrailingProse(match[0])
    if (!trimmed) {
      continue
    }
    const link = toFileUriLink(trimmed, startIndex)
    if (link) {
      links.push(link)
    }
  }
  return links
}
