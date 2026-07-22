type WorktreeIncludeGlobToken =
  | { kind: 'literal'; value: string; caseFoldedValue: string }
  | { kind: 'one' }
  | { kind: 'segment-star' }
  | { kind: 'recursive-star' }
  | { kind: 'optional-slash' }

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
      if (pattern[index + 1] === '*') {
        tokens.push({ kind: 'recursive-star' })
        regex += '.*'
        index++
        if (pattern[index + 1] === '/') {
          tokens.push({ kind: 'optional-slash' })
          regex += '/?'
          index++
        }
      } else {
        tokens.push({ kind: 'segment-star' })
        regex += '[^/]*'
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
    (token) => token.kind === 'segment-star' || token.kind === 'recursive-star'
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
    } else if (token.kind === 'optional-slash') {
      current[0] = previous[0]
      for (let index = 1; index <= value.length; index++) {
        current[index] =
          previous[index] || (comparableValue[index - 1] === '/' && previous[index - 1]) ? 1 : 0
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
