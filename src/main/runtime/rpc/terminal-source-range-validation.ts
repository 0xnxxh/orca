import {
  assertTerminalOutputSourceRange,
  sameTerminalOutputSourceIdentity,
  type TerminalOutputSourceRange
} from '../../../shared/terminal-output-source-range'

export function freezeTerminalOutputSourceRanges(
  ranges: readonly TerminalOutputSourceRange[]
): readonly TerminalOutputSourceRange[] {
  return Object.freeze(
    ranges.map((range) =>
      Object.freeze({
        ...range,
        transform: Object.freeze({ ...range.transform })
      })
    )
  )
}

export function validateTerminalSourceRangeFrame(
  displayLength: number,
  ranges: readonly TerminalOutputSourceRange[]
): boolean {
  if (!Number.isSafeInteger(displayLength) || displayLength < 0) {
    return false
  }
  if (ranges.length === 0) {
    return true
  }
  try {
    for (const range of ranges) {
      assertTerminalOutputSourceRange(range)
    }
  } catch {
    return false
  }
  const first = ranges[0]!
  let previous = first
  for (const range of ranges.slice(1)) {
    if (
      !sameTerminalOutputSourceIdentity(first, range) ||
      range.sourceStartSu !== previous.sourceEndSu ||
      range.displayStart !== previous.displayEnd
    ) {
      return false
    }
    previous = range
  }
  return previous.displayEnd - first.displayStart === displayLength
}
