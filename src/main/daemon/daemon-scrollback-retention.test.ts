import { describe, expect, it } from 'vitest'
import {
  DAEMON_PARKED_FULL_DEPTH_CAP,
  resolveParkedFullDepthCap,
  selectParkedSessionsToTrim,
  type SessionRetentionEntry
} from './daemon-scrollback-retention'

function entry(sessionId: string, attached: boolean, recency: number): SessionRetentionEntry {
  return { sessionId, attached, recency }
}

describe('selectParkedSessionsToTrim', () => {
  it('trims nothing while parked sessions fit the cap', () => {
    const entries = [entry('a', false, 1), entry('b', false, 2), entry('c', true, 3)]
    expect(selectParkedSessionsToTrim(entries, 2)).toEqual([])
  })

  it('never trims an attached session and attached sessions do not consume the cap', () => {
    const entries = [
      entry('viewed-1', true, 1),
      entry('viewed-2', true, 2),
      entry('parked-old', false, 3),
      entry('parked-new', false, 4)
    ]
    // Cap of 2 covers both parked sessions even with two attached ones present.
    expect(selectParkedSessionsToTrim(entries, 2)).toEqual([])
    // Cap of 1 trims only the least recently viewed parked session.
    expect(selectParkedSessionsToTrim(entries, 1)).toEqual(['parked-old'])
  })

  it('evicts least-recently-viewed first, keeping the most recent parked sessions deep', () => {
    const entries = [
      entry('oldest', false, 1),
      entry('middle', false, 2),
      entry('newest', false, 3)
    ]
    expect(selectParkedSessionsToTrim(entries, 1)).toEqual(['middle', 'oldest'])
  })

  it('a reattached session leaves the parked set entirely', () => {
    const parkedBeyondCap = [entry('a', false, 1), entry('b', false, 2)]
    expect(selectParkedSessionsToTrim(parkedBeyondCap, 1)).toEqual(['a'])
    // 'a' gets viewed: attached now, so 'b' alone fits the cap.
    const reattached = [entry('a', true, 3), entry('b', false, 2)]
    expect(selectParkedSessionsToTrim(reattached, 1)).toEqual([])
  })

  it('handles the empty host', () => {
    expect(selectParkedSessionsToTrim([], 1)).toEqual([])
  })
})

describe('resolveParkedFullDepthCap', () => {
  it('defaults to the standard cap', () => {
    expect(resolveParkedFullDepthCap({} as NodeJS.ProcessEnv)).toBe(DAEMON_PARKED_FULL_DEPTH_CAP)
  })

  it('lets an override tighten the cap but never weaken it', () => {
    const tightened = { ORCA_DAEMON_PARKED_FULL_DEPTH_CAP: '4' } as NodeJS.ProcessEnv
    expect(resolveParkedFullDepthCap(tightened)).toBe(4)
    // Why: raising the cap raises worst-case daemon memory — the failure this module exists to prevent.
    const weakened = {
      ORCA_DAEMON_PARKED_FULL_DEPTH_CAP: String(DAEMON_PARKED_FULL_DEPTH_CAP * 10)
    } as NodeJS.ProcessEnv
    expect(resolveParkedFullDepthCap(weakened)).toBe(DAEMON_PARKED_FULL_DEPTH_CAP)
  })

  it('ignores malformed overrides', () => {
    for (const raw of ['nonsense', '0', '-5', '3.5', '']) {
      const env = { ORCA_DAEMON_PARKED_FULL_DEPTH_CAP: raw } as NodeJS.ProcessEnv
      expect(resolveParkedFullDepthCap(env)).toBe(DAEMON_PARKED_FULL_DEPTH_CAP)
    }
  })
})
