// Why: a raw-byte cap is not enough. JSON escaping expands a control character sixfold and
// binary-buffer.ts sniffs only for NUL, so control-dense content is classified as text; these
// fixtures pin every branch of the measurement to native JSON.stringify.
import { describe, expect, it } from 'vitest'
import type { GitDiffResult } from './types'
import {
  GIT_DIFF_MAX_TRANSPORT_CONTENT_BYTES,
  assertGitDiffWithinTransportBudget,
  gitDiffTransportContentBytes
} from './git-diff-transport-budget'

const BUDGET = GIT_DIFF_MAX_TRANSPORT_CONTENT_BYTES

/** Native reference: the bytes the two content sides occupy once JSON-encoded. */
function referenceContentBytes(result: GitDiffResult): number {
  return (
    Buffer.byteLength(JSON.stringify(result.originalContent), 'utf8') +
    Buffer.byteLength(JSON.stringify(result.modifiedContent), 'utf8')
  )
}

/** Content whose JSON encoding, quotes included, is exactly `jsonBytes`. */
function sideOfJsonBytes(unit: string, jsonBytes: number): string {
  const unitCost = Buffer.byteLength(JSON.stringify(unit), 'utf8') - 2
  const count = Math.floor((jsonBytes - 2) / unitCost)
  return unit.repeat(count) + 'x'.repeat(jsonBytes - 2 - count * unitCost)
}

function textDiff(modifiedContent: string): GitDiffResult {
  return {
    kind: 'text',
    originalContent: '',
    modifiedContent,
    originalIsBinary: false,
    modifiedIsBinary: false
  }
}

function budgetError(result: GitDiffResult): { code?: string; data?: unknown } {
  try {
    assertGitDiffWithinTransportBudget(result, BUDGET)
  } catch (error) {
    return error as { code?: string; data?: unknown }
  }
  throw new Error('expected the transport budget assertion to throw')
}

const UNITS: readonly { name: string; unit: string; expansion: number }[] = [
  { name: 'ascii', unit: 'a', expansion: 1 },
  { name: 'newline-dense text', unit: '\n', expansion: 2 },
  { name: 'control-char text (0x01)', unit: '\u0001', expansion: 6 },
  { name: 'base64', unit: 'QUJD', expansion: 1 },
  { name: 'cjk', unit: '漢', expansion: 1 },
  { name: 'lone surrogate', unit: '\ud800', expansion: 2 }
]

describe('gitDiffTransportContentBytes', () => {
  it.each(UNITS)('pins the JSON expansion assumed for $name', ({ unit, expansion }) => {
    const jsonBytes = Buffer.byteLength(JSON.stringify(unit), 'utf8') - 2
    expect(jsonBytes / Buffer.byteLength(unit, 'utf8')).toBe(expansion)
  })

  it.each(UNITS)('admits $name exactly at the budget', ({ unit }) => {
    const result = textDiff(sideOfJsonBytes(unit, BUDGET - 2))

    expect(referenceContentBytes(result)).toBe(BUDGET)
    expect(gitDiffTransportContentBytes(result, BUDGET)).toBe(BUDGET)
    expect(assertGitDiffWithinTransportBudget(result, BUDGET)).toBe(result)
  })

  it.each(UNITS)('rejects $name one byte above the budget', ({ unit }) => {
    const result = textDiff(sideOfJsonBytes(unit, BUDGET - 1))

    expect(referenceContentBytes(result)).toBe(BUDGET + 1)
    expect(gitDiffTransportContentBytes(result, BUDGET)).toBeGreaterThan(BUDGET)
    expect(budgetError(result).code).toBe('diff_too_large')
  })

  it.each(UNITS)('agrees with native JSON.stringify across the boundary for $name', ({ unit }) => {
    for (const jsonBytes of [BUDGET - 3, BUDGET - 2, BUDGET - 1]) {
      const result = textDiff(sideOfJsonBytes(unit, jsonBytes))
      expect(gitDiffTransportContentBytes(result, BUDGET) <= BUDGET).toBe(
        referenceContentBytes(result) <= BUDGET
      )
    }
  })

  // Why: this is the case a raw-byte budget silently lets through into the 1013 close.
  it('rejects control-dense content whose raw bytes are far under the budget', () => {
    const result = textDiff(sideOfJsonBytes('\u0001', BUDGET - 1))

    expect(Buffer.byteLength(result.modifiedContent, 'utf8')).toBeLessThan(BUDGET / 5)
    expect(budgetError(result).data).toEqual({ byteLength: BUDGET + 1, maxBytes: BUDGET })
  })

  it('splits the budget across both sides', () => {
    const half = Math.floor(BUDGET / 2)
    const overBudget: GitDiffResult = {
      kind: 'binary',
      originalContent: sideOfJsonBytes('Q', half),
      modifiedContent: sideOfJsonBytes('Q', BUDGET - half + 1),
      originalIsBinary: true,
      modifiedIsBinary: true
    }

    expect(referenceContentBytes(overBudget)).toBe(BUDGET + 1)
    expect(budgetError(overBudget).code).toBe('diff_too_large')
  })

  // The fast path returns the raw sum, which omits the quote bytes the exact scan counts.
  it('admits small content without an escape-aware scan', () => {
    const result = textDiff('hello')

    expect(gitDiffTransportContentBytes(result, BUDGET)).toBe(5)
    expect(referenceContentBytes(result)).toBe(9)
  })

  it('leaves local callers uncapped', () => {
    const result = textDiff('x'.repeat(BUDGET + 1))

    expect(assertGitDiffWithinTransportBudget(result, undefined)).toBe(result)
  })
})
