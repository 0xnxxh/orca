// Why: the invariant the whole cap rests on — a diff that exactly fills the content budget must
// still serialize inside the outbound JSON limit once wrapped in an RPC reply. A base64-only
// version of this passes trivially; the newline and control-char fixtures are the load-bearing ones.
import { describe, expect, it } from 'vitest'
import type { GitDiffResult } from './types'
import { GIT_DIFF_MAX_TRANSPORT_CONTENT_BYTES } from './git-diff-transport-budget'
import {
  REMOTE_RUNTIME_MAX_OUTBOUND_CONTENT_BYTES,
  REMOTE_RUNTIME_MAX_OUTBOUND_JSON_BYTES,
  REMOTE_RUNTIME_OUTBOUND_ENVELOPE_RESERVE_BYTES
} from './remote-runtime-capacity-limits'

const BUDGET = GIT_DIFF_MAX_TRANSPORT_CONTENT_BYTES

function sideOfJsonBytes(unit: string, jsonBytes: number): string {
  const unitCost = Buffer.byteLength(JSON.stringify(unit), 'utf8') - 2
  const count = Math.floor((jsonBytes - 2) / unitCost)
  return unit.repeat(count) + 'x'.repeat(jsonBytes - 2 - count * unitCost)
}

function replyBytes(result: GitDiffResult): number {
  return Buffer.byteLength(
    JSON.stringify({
      id: 'req_0123456789abcdef',
      ok: true,
      result,
      _meta: { runtimeId: '00000000-0000-4000-8000-000000000000' }
    }),
    'utf8'
  )
}

describe('git diff envelope ceiling', () => {
  it.each([
    ['ascii', 'a'],
    ['newline-dense text', '\n'],
    ['control-char text (0x01)', '\u0001'],
    ['base64', 'QUJD'],
    ['cjk', '漢'],
    ['lone surrogate', '\ud800']
  ])('keeps a %s diff at the budget inside the outbound JSON limit', (_name, unit) => {
    const result: GitDiffResult = {
      kind: 'binary',
      originalContent: sideOfJsonBytes(unit, Math.floor(BUDGET / 2)),
      modifiedContent: sideOfJsonBytes(unit, BUDGET - Math.floor(BUDGET / 2)),
      isImage: true,
      mimeType: 'image/png',
      originalIsBinary: true,
      modifiedIsBinary: true
    }

    expect(replyBytes(result)).toBeLessThanOrEqual(REMOTE_RUNTIME_MAX_OUTBOUND_JSON_BYTES)
  })

  it('derives the budget from the outbound JSON limit', () => {
    expect(BUDGET).toBe(REMOTE_RUNTIME_MAX_OUTBOUND_CONTENT_BYTES)
    expect(BUDGET).toBeLessThan(REMOTE_RUNTIME_MAX_OUTBOUND_JSON_BYTES)
  })

  // Why: every reserved byte is content that transferred before this cap existed, so the reserve
  // must stay close to the real envelope overhead. Fails if someone inflates it "just to be safe".
  it('keeps the envelope reserve within 64x the real overhead it covers', () => {
    const atBudget: GitDiffResult = {
      kind: 'binary',
      originalContent: sideOfJsonBytes('a', Math.floor(BUDGET / 2)),
      modifiedContent: sideOfJsonBytes('a', BUDGET - Math.floor(BUDGET / 2)),
      isImage: true,
      mimeType: 'image/png',
      originalIsBinary: true,
      modifiedIsBinary: true
    }
    const overhead = replyBytes(atBudget) - BUDGET

    expect(overhead).toBeLessThan(REMOTE_RUNTIME_OUTBOUND_ENVELOPE_RESERVE_BYTES)
    expect(REMOTE_RUNTIME_OUTBOUND_ENVELOPE_RESERVE_BYTES).toBeLessThan(overhead * 64)
  })
})
