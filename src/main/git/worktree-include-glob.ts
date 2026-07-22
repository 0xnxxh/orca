type WorktreeIncludeGlobToken =
  | { kind: 'literal'; value: string }
  | { kind: 'one' }
  | { kind: 'segment-star' }
  | { kind: 'recursive-star' }
  | { kind: 'optional-slash' }

export type CompiledWorktreeIncludeGlob = {
  regExp: RegExp | null
  tokens: readonly WorktreeIncludeGlobToken[]
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
      tokens.push({ kind: 'literal', value: char })
      regex += char.replace(/[.+^${}()|[\]\\]/, '\\$&')
    }
  }
  return {
    // Why: multiple variable-width groups can make JS regex backtracking exponential.
    regExp: starCount <= 1 ? new RegExp(`^${regex}$`) : null,
    tokens
  }
}

export function getWorktreeIncludeGlobStepCount(
  pattern: CompiledWorktreeIncludeGlob,
  value: string
): number {
  return pattern.regExp === null ? pattern.tokens.length * (value.length + 1) : value.length + 1
}

export function matchesWorktreeIncludeGlob(
  pattern: CompiledWorktreeIncludeGlob,
  value: string
): boolean {
  if (pattern.regExp !== null) {
    return pattern.regExp.test(value)
  }

  let previous = new Uint8Array(value.length + 1)
  previous[0] = 1
  for (const token of pattern.tokens) {
    const current = new Uint8Array(value.length + 1)
    if (token.kind === 'segment-star' || token.kind === 'recursive-star') {
      current[0] = previous[0]
      for (let index = 1; index <= value.length; index++) {
        const canConsume = token.kind === 'recursive-star' || value[index - 1] !== '/'
        current[index] = previous[index] || (canConsume && current[index - 1]) ? 1 : 0
      }
    } else if (token.kind === 'optional-slash') {
      current[0] = previous[0]
      for (let index = 1; index <= value.length; index++) {
        current[index] =
          previous[index] || (value[index - 1] === '/' && previous[index - 1]) ? 1 : 0
      }
    } else {
      for (let index = 1; index <= value.length; index++) {
        const matches =
          token.kind === 'one' ? value[index - 1] !== '/' : value[index - 1] === token.value
        current[index] = previous[index - 1] && matches ? 1 : 0
      }
    }
    previous = current
  }
  return previous[value.length] === 1
}
