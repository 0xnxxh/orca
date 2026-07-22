import {
  compileWorktreeIncludeGlob,
  getWorktreeIncludeGlobStepCount,
  matchesWorktreeIncludeGlob,
  type CompiledWorktreeIncludeGlob
} from './worktree-include-glob'

const WORKTREE_INCLUDE_FILE = '.worktreeinclude'
const WORKTREE_INCLUDE_MAX_PATTERNS = 4_096
export const WORKTREE_INCLUDE_MATCH_STEP_BUDGET = 5_000_000

export type WorktreeIncludePattern = {
  negated: boolean
  /** Pattern with `!`, leading `/`, and trailing `/` stripped. */
  body: string
  dirOnly: boolean
  anchored: boolean
  hasGlob: boolean
  glob: CompiledWorktreeIncludeGlob | null
}

export type WorktreeIncludeMatchBudget = { remaining: number }

export function parseWorktreeIncludePatterns(content: string): WorktreeIncludePattern[] {
  const patterns: WorktreeIncludePattern[] = []
  for (const rawLine of content.split(/\r?\n/)) {
    const line = rawLine.trim()
    if (!line || line.startsWith('#')) {
      continue
    }
    const negated = line.startsWith('!')
    const withoutNegation = negated ? line.slice(1) : line
    const dirOnly = withoutNegation.endsWith('/')
    // Why: a slash anywhere except the end anchors a gitignore pattern to the repo root.
    const trimmed = withoutNegation.replace(/^\//, '').replace(/\/+$/, '')
    if (!trimmed) {
      continue
    }
    const anchored = withoutNegation.startsWith('/') || trimmed.includes('/')
    const hasGlob = /[*?]/.test(trimmed)
    patterns.push({
      negated,
      body: trimmed,
      dirOnly,
      anchored,
      hasGlob,
      glob: hasGlob ? compileWorktreeIncludeGlob(trimmed) : null
    })
    if (patterns.length > WORKTREE_INCLUDE_MAX_PATTERNS) {
      throw new Error(`${WORKTREE_INCLUDE_FILE} contains too many patterns`)
    }
  }
  return patterns
}

function spendMatchBudget(budget: WorktreeIncludeMatchBudget, steps: number): void {
  budget.remaining -= steps
  if (budget.remaining < 0) {
    throw new Error(`${WORKTREE_INCLUDE_FILE} matching exceeded its CPU budget`)
  }
}

function globMatches(
  pattern: WorktreeIncludePattern,
  subject: string,
  budget: WorktreeIncludeMatchBudget
): boolean {
  if (pattern.glob === null) {
    return false
  }
  spendMatchBudget(budget, getWorktreeIncludeGlobStepCount(pattern.glob, subject))
  return matchesWorktreeIncludeGlob(pattern.glob, subject)
}

function patternMatches(
  pattern: WorktreeIncludePattern,
  relativePath: string,
  isDirectory: boolean,
  budget: WorktreeIncludeMatchBudget
): boolean {
  if (!pattern.hasGlob) {
    if (pattern.anchored) {
      spendMatchBudget(budget, relativePath.length + 1)
      return (
        (relativePath === pattern.body && (!pattern.dirOnly || isDirectory)) ||
        relativePath.startsWith(`${pattern.body}/`)
      )
    }
    const segments = relativePath.split('/')
    const lastMatchableIndex =
      pattern.dirOnly && !isDirectory ? segments.length - 2 : segments.length - 1
    spendMatchBudget(budget, relativePath.length + 1)
    return segments.slice(0, lastMatchableIndex + 1).includes(pattern.body)
  }

  const segments = relativePath.split('/')
  const lastMatchableIndex =
    pattern.dirOnly && !isDirectory ? segments.length - 2 : segments.length - 1
  if (lastMatchableIndex < 0) {
    return false
  }
  if (!pattern.anchored) {
    for (let index = 0; index <= lastMatchableIndex; index++) {
      if (globMatches(pattern, segments[index], budget)) {
        return true
      }
    }
    return false
  }

  let prefix = ''
  for (let index = 0; index <= lastMatchableIndex; index++) {
    prefix = prefix ? `${prefix}/${segments[index]}` : segments[index]
    if (globMatches(pattern, prefix, budget)) {
      return true
    }
  }
  return false
}

export function isIncludedByWorktreePatterns(
  patterns: readonly WorktreeIncludePattern[],
  relativePath: string,
  isDirectory: boolean,
  budget: WorktreeIncludeMatchBudget
): boolean {
  // Why: gitignore patterns are order-sensitive, so negations must use last-match-wins.
  let included = false
  for (const pattern of patterns) {
    if (patternMatches(pattern, relativePath, isDirectory, budget)) {
      included = !pattern.negated
    }
  }
  return included
}
