import { parseTomlSingleLineStringValue } from './config-toml-line-scan'

export type ParsedTomlKeyPath = {
  segments: string[]
  end: number
}

export function getTomlTableName(header: string): string | null {
  const trimmed = header.trim()
  if (trimmed.startsWith('[[')) {
    return null
  }
  const match = /^\[(.+)\]$/.exec(trimmed)
  if (!match) {
    return null
  }
  const parsed = parseTomlKeyPath(match[1]!)
  return parsed && parsed.end === match[1]!.length ? parsed.segments.join('.') : null
}

export function parseTomlKeyPath(source: string, offset = 0): ParsedTomlKeyPath | null {
  const segments: string[] = []
  let index = skipTomlKeyWhitespace(source, offset)
  while (index < source.length) {
    const quoted = parseTomlSingleLineStringValue(source, index)
    if (quoted) {
      segments.push(quoted.value)
      index = quoted.end
    } else {
      const bare = /^[A-Za-z0-9_-]+/.exec(source.slice(index))
      if (!bare) {
        return null
      }
      segments.push(bare[0])
      index += bare[0].length
    }
    index = skipTomlKeyWhitespace(source, index)
    if (source[index] !== '.') {
      return { segments, end: index }
    }
    index = skipTomlKeyWhitespace(source, index + 1)
  }
  return null
}

function skipTomlKeyWhitespace(source: string, offset: number): number {
  let index = offset
  while (source[index] === ' ' || source[index] === '\t') {
    index += 1
  }
  return index
}
