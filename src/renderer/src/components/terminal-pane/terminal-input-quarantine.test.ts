import { describe, it, expect, beforeEach } from 'vitest'
import {
  armTerminalInputQuarantine,
  shouldQuarantineTerminalInput,
  isTerminalInputQuarantined,
  releaseTerminalInputQuarantine,
  consumeTerminalInputQuarantineNotice,
  formatTerminalPaneNotice,
  _resetTerminalInputQuarantineForTests
} from './terminal-input-quarantine'

describe('terminal input quarantine', () => {
  beforeEach(() => {
    _resetTerminalInputQuarantineForTests()
  })

  it('passes input through when nothing armed it', () => {
    expect(shouldQuarantineTerminalInput('pty-a', 'l')).toBe(false)
  })

  it('drops the tail of a line whose head died with the old daemon', () => {
    // Why revert-sensitive: without the quarantine these characters reach the
    // replacement shell, which then runs the fragment of a command the user
    // never completed (STA-2373: `echo hi; rm -rf x` -> `cho hi; rm -rf x`,
    // where zsh fails `cho` but still executes `rm -rf x` after the `;`).
    armTerminalInputQuarantine('pty-a')
    for (const ch of 'cho hi; rm -rf x') {
      expect(shouldQuarantineTerminalInput('pty-a', ch)).toBe(true)
    }
  })

  it('swallows the submit that would have run the mangled line, then releases', () => {
    armTerminalInputQuarantine('pty-a')
    expect(shouldQuarantineTerminalInput('pty-a', 'x')).toBe(true)
    expect(shouldQuarantineTerminalInput('pty-a', '\r')).toBe(true)
    expect(isTerminalInputQuarantined('pty-a')).toBe(false)
    // The next line is typed against a clean prompt and must reach the shell.
    expect(shouldQuarantineTerminalInput('pty-a', 'l')).toBe(false)
  })

  it('treats a newline as a line boundary too', () => {
    armTerminalInputQuarantine('pty-a')
    expect(shouldQuarantineTerminalInput('pty-a', '\n')).toBe(true)
    expect(isTerminalInputQuarantined('pty-a')).toBe(false)
  })

  it('releases a chunk that carries its own newline, so pasted input is not stuck', () => {
    armTerminalInputQuarantine('pty-a')
    expect(shouldQuarantineTerminalInput('pty-a', 'abc\r')).toBe(true)
    expect(isTerminalInputQuarantined('pty-a')).toBe(false)
  })

  it('quarantines each pane independently', () => {
    armTerminalInputQuarantine('pty-a')
    expect(shouldQuarantineTerminalInput('pty-a', 'a')).toBe(true)
    expect(shouldQuarantineTerminalInput('pty-b', 'a')).toBe(false)
  })

  it('releases on the deadline so input is never permanently dead', () => {
    // Why: the normal release is the user's next Enter. Someone who switches away
    // mid-line never sends one, and a pane that silently eats input forever would
    // be a worse bug than the one being fixed.
    const t0 = 1_000_000
    armTerminalInputQuarantine('pty-a', t0)
    expect(shouldQuarantineTerminalInput('pty-a', 'a', t0 + 14_999)).toBe(true)
    expect(shouldQuarantineTerminalInput('pty-a', 'a', t0 + 15_000)).toBe(false)
    expect(isTerminalInputQuarantined('pty-a')).toBe(false)
  })

  it('keeps the original deadline when the same incident re-arms', () => {
    // Both the provider fan-out and the per-write catch signal the written pane,
    // so arming happens more than once per death; that must not extend the window.
    const t0 = 1_000_000
    armTerminalInputQuarantine('pty-a', t0)
    armTerminalInputQuarantine('pty-a', t0 + 10_000)
    expect(shouldQuarantineTerminalInput('pty-a', 'a', t0 + 15_000)).toBe(false)
  })

  it('can be released explicitly', () => {
    armTerminalInputQuarantine('pty-a')
    releaseTerminalInputQuarantine('pty-a')
    expect(shouldQuarantineTerminalInput('pty-a', 'a')).toBe(false)
  })

  it('offers the notice exactly once per quarantine', () => {
    armTerminalInputQuarantine('pty-a')
    expect(consumeTerminalInputQuarantineNotice('pty-a')).toBe(true)
    expect(consumeTerminalInputQuarantineNotice('pty-a')).toBe(false)
  })

  it('offers no notice for a pane that was never quarantined', () => {
    expect(consumeTerminalInputQuarantineNotice('pty-a')).toBe(false)
  })

  it('offers the notice again for a second, separate incident', () => {
    armTerminalInputQuarantine('pty-a')
    expect(consumeTerminalInputQuarantineNotice('pty-a')).toBe(true)
    releaseTerminalInputQuarantine('pty-a')
    armTerminalInputQuarantine('pty-a')
    expect(consumeTerminalInputQuarantineNotice('pty-a')).toBe(true)
  })

  it('renders the notice with an inverse-video gutter and no hardcoded colour', () => {
    const notice = formatTerminalPaneNotice('Terminal reconnected.')
    // Inverse video (SGR 7) keeps it legible on any theme or shell palette; a
    // colour would have to be picked per theme and could vanish on some palettes.
    expect(notice).toContain('\u001b[7m')
    expect(notice).toContain('Terminal reconnected.')
    expect(notice.startsWith('\r\n')).toBe(true)
    expect(notice.endsWith('\u001b[0m\r\n')).toBe(true)
    // No SGR 3x/4x foreground or background codes: nothing theme-specific to get wrong.
    expect(notice).not.toMatch(/\[[34]\d/)
  })

  it('releases a sibling pane independently, so one Enter cannot unblock the other', () => {
    // Why: split panes share a tab. A tab-wide key would let Enter in pane A hand
    // pane B the mangled tail this exists to prevent — the STA-2373 sibling case.
    armTerminalInputQuarantine('pty-a')
    armTerminalInputQuarantine('pty-b')
    expect(shouldQuarantineTerminalInput('pty-a', '\r')).toBe(true)
    expect(isTerminalInputQuarantined('pty-a')).toBe(false)
    expect(isTerminalInputQuarantined('pty-b')).toBe(true)
    expect(shouldQuarantineTerminalInput('pty-b', 'x')).toBe(true)
  })
})
