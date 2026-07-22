type WorktreeIncludeGlobToken =
  | { kind: 'literal'; value: string; caseFoldedValue: string }
  | { kind: 'one' }
  | { kind: 'segment-star' }
  | { kind: 'recursive-star' }
  | { kind: 'recursive-directory' }

export type CompiledWorktreeIncludeGlob = {
  regExp: RegExp | null
  ignoreCaseRegExp: RegExp | null | undefined
  tokens: readonly WorktreeIncludeGlobToken[]
  variableWidthSuffixLength: number | null
}

export function compileWorktreeIncludeGlob(pattern: string): CompiledWorktreeIncludeGlob {
  const tokens: WorktreeIncludeGlobToken[] = []
  let regex = ''
  let starCount = 0
  for (let index = 0; index < pattern.length; index++) {
    const char = pattern[index]
    if (char === '*') {
      starCount++
      let starEnd = index
      while (pattern[starEnd + 1] === '*') {
        starEnd++
      }
      if (starEnd > index && pattern[starEnd + 1] === '/') {
        // Why: `**/` consumes complete directory prefixes; making only the slash
        // optional incorrectly lets `foo/**/bar` match `foo/xbar`.
        tokens.push({ kind: 'recursive-directory' })
        regex += '(?:.*/)?'
        index = starEnd + 1
      } else if (starEnd > index && starEnd === pattern.length - 1) {
        tokens.push({ kind: 'recursive-star' })
        regex += '.*'
        index = starEnd
      } else {
        tokens.push({ kind: 'segment-star' })
        regex += '[^/]*'
        index = starEnd
      }
    } else if (char === '?') {
      tokens.push({ kind: 'one' })
      regex += '[^/]'
    } else {
      tokens.push({ kind: 'literal', value: char, caseFoldedValue: char.toLowerCase() })
      regex += char.replace(/[.+^${}()|[\]\\]/, '\\$&')
    }
  }
  const variableWidthIndex = tokens.findIndex(
    (token) =>
      token.kind === 'segment-star' ||
      token.kind === 'recursive-star' ||
      token.kind === 'recursive-directory'
  )
  return {
    // Why: multiple variable-width groups can make JS regex backtracking exponential.
    regExp: starCount <= 1 ? new RegExp(`^${regex}$`) : null,
    ignoreCaseRegExp: starCount <= 1 ? undefined : null,
    tokens,
    variableWidthSuffixLength:
      variableWidthIndex === -1 ? null : tokens.length - variableWidthIndex - 1
  }
}

export function getWorktreeIncludeGlobStepCount(
  pattern: CompiledWorktreeIncludeGlob,
  value: string
): number {
  if (pattern.regExp === null) {
    return pattern.tokens.length * (value.length + 1)
  }
  if (pattern.variableWidthSuffixLength !== null) {
    const prefixLength = pattern.tokens.length - pattern.variableWidthSuffixLength - 1
    return prefixLength + (pattern.variableWidthSuffixLength + 1) * (value.length + 1)
  }
  return pattern.tokens.length + value.length + 1
}

export function matchesWorktreeIncludeGlob(
  pattern: CompiledWorktreeIncludeGlob,
  value: string,
  ignoreCase: boolean = false
): boolean {
  if (pattern.regExp !== null) {
    if (!ignoreCase) {
      return pattern.regExp.test(value)
    }
    pattern.ignoreCaseRegExp ??= new RegExp(pattern.regExp.source, 'i')
    return pattern.ignoreCaseRegExp.test(value)
  }

  const comparableValue = ignoreCase ? value.toLowerCase() : value
  let previous = new Uint8Array(value.length + 1)
  previous[0] = 1
  for (const token of pattern.tokens) {
    const current = new Uint8Array(value.length + 1)
    if (token.kind === 'segment-star' || token.kind === 'recursive-star') {
      current[0] = previous[0]
      for (let index = 1; index <= value.length; index++) {
        const canConsume = token.kind === 'recursive-star' || comparableValue[index - 1] !== '/'
        current[index] = previous[index] || (canConsume && current[index - 1]) ? 1 : 0
      }
    } else if (token.kind === 'recursive-directory') {
      current[0] = previous[0]
      let canConsume = previous[0] === 1
      for (let index = 1; index <= value.length; index++) {
        canConsume ||= previous[index - 1] === 1
        current[index] =
          previous[index] || (canConsume && comparableValue[index - 1] === '/') ? 1 : 0
      }
    } else {
      for (let index = 1; index <= value.length; index++) {
        const matches =
          token.kind === 'one'
            ? comparableValue[index - 1] !== '/'
            : ignoreCase
              ? comparableValue[index - 1] === token.caseFoldedValue
              : comparableValue[index - 1] === token.value
        current[index] = previous[index - 1] && matches ? 1 : 0
      }
    }
    previous = current
  }
  return previous[value.length] === 1
}
