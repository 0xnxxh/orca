import { describe, it, expect, beforeEach } from 'vitest'
import {
  armTerminalInputQuarantine,
  shouldQuarantineTerminalInput,
  isTerminalInputQuarantined,
  releaseTerminalInputQuarantine,
  _resetTerminalInputQuarantineForTests
} from './terminal-input-quarantine'

describe('terminal input quarantine', () => {
  beforeEach(() => {
    _resetTerminalInputQuarantineForTests()
  })

  it('passes input through when nothing armed it', () => {
    expect(shouldQuarantineTerminalInput('tab-1', 'l')).toBe(false)
  })

  it('drops the tail of a line whose head died with the old daemon', () => {
    // Why revert-sensitive: without the quarantine these characters reach the
    // replacement shell, which then runs the fragment of a command the user
    // never completed (STA-2373: `echo hi; rm -rf x` -> `cho hi; rm -rf x`,
    // where zsh fails `cho` but still executes `rm -rf x` after the `;`).
    armTerminalInputQuarantine('tab-1')
    for (const ch of 'cho hi; rm -rf x') {
      expect(shouldQuarantineTerminalInput('tab-1', ch)).toBe(true)
    }
  })

  it('swallows the submit that would have run the mangled line, then releases', () => {
    armTerminalInputQuarantine('tab-1')
    expect(shouldQuarantineTerminalInput('tab-1', 'x')).toBe(true)
    expect(shouldQuarantineTerminalInput('tab-1', '\r')).toBe(true)
    expect(isTerminalInputQuarantined('tab-1')).toBe(false)
    // The next line is typed against a clean prompt and must reach the shell.
    expect(shouldQuarantineTerminalInput('tab-1', 'l')).toBe(false)
  })

  it('treats a newline as a line boundary too', () => {
    armTerminalInputQuarantine('tab-1')
    expect(shouldQuarantineTerminalInput('tab-1', '\n')).toBe(true)
    expect(isTerminalInputQuarantined('tab-1')).toBe(false)
  })

  it('releases a chunk that carries its own newline, so pasted input is not stuck', () => {
    armTerminalInputQuarantine('tab-1')
    expect(shouldQuarantineTerminalInput('tab-1', 'abc\r')).toBe(true)
    expect(isTerminalInputQuarantined('tab-1')).toBe(false)
  })

  it('quarantines each tab independently', () => {
    armTerminalInputQuarantine('tab-1')
    expect(shouldQuarantineTerminalInput('tab-1', 'a')).toBe(true)
    expect(shouldQuarantineTerminalInput('tab-2', 'a')).toBe(false)
  })

  it('releases on the deadline so input is never permanently dead', () => {
    // Why: the normal release is the user's next Enter. Someone who switches away
    // mid-line never sends one, and a pane that silently eats input forever would
    // be a worse bug than the one being fixed.
    const t0 = 1_000_000
    armTerminalInputQuarantine('tab-1', t0)
    expect(shouldQuarantineTerminalInput('tab-1', 'a', t0 + 14_999)).toBe(true)
    expect(shouldQuarantineTerminalInput('tab-1', 'a', t0 + 15_000)).toBe(false)
    expect(isTerminalInputQuarantined('tab-1')).toBe(false)
  })

  it('keeps the original deadline when the same incident re-arms', () => {
    // Both the provider fan-out and the per-write catch signal the written pane,
    // so arming happens more than once per death; that must not extend the window.
    const t0 = 1_000_000
    armTerminalInputQuarantine('tab-1', t0)
    armTerminalInputQuarantine('tab-1', t0 + 10_000)
    expect(shouldQuarantineTerminalInput('tab-1', 'a', t0 + 15_000)).toBe(false)
  })

  it('can be released explicitly', () => {
    armTerminalInputQuarantine('tab-1')
    releaseTerminalInputQuarantine('tab-1')
    expect(shouldQuarantineTerminalInput('tab-1', 'a')).toBe(false)
  })
})
