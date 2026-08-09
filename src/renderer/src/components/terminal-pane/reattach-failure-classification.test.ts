/**
 * Duplicate-agent oracles. Reattach failure used to converge on "spawn a fresh
 * shell", so a transient fault started a second `--resume` against the same
 * agent session and both processes appended to one transcript.
 *
 * Respawn requires proof the session is gone. These pin which failures qualify.
 */
import { describe, expect, it } from 'vitest'
import { isProvenSshSessionGoneError } from './reattach-failure-classification'

describe('reattach failure classification', () => {
  it('treats an explicit host expiry as proof', () => {
    expect(isProvenSshSessionGoneError(new Error('SSH_SESSION_EXPIRED: ssh-1:pty-9'))).toBe(true)
  })

  it('treats a not-found PTY as proof', () => {
    expect(isProvenSshSessionGoneError(new Error('PTY "pty-9" not found'))).toBe(true)
  })

  // The reported defect: a source that needs re-establishing was reported as
  // expiry, so the pane respawned and duplicate-resumed a live agent session.
  it('does not treat a required source restore as proof', () => {
    expect(isProvenSshSessionGoneError(new Error('SSH_SOURCE_RESTORE_REQUIRED: ssh-1:pty-9'))).toBe(
      false
    )
  })

  it.each([
    ['a transport fault', new Error('read ECONNRESET')],
    ['a timed-out call', new Error('relay request timed out')],
    ['a disconnected client', new Error('client_disconnected')],
    ['an unavailable owner', new Error('execution_owner_unavailable')],
    ['an identity mismatch', new Error('SSH_PTY_IDENTITY_MISMATCH')],
    ['an empty rejection value', ''],
    ['a non-Error rejection', 'something went wrong']
  ])('does not treat %s as proof', (_label, error) => {
    expect(isProvenSshSessionGoneError(error)).toBe(false)
  })

  // A new failure mode must not silently become a respawn.
  it('defaults an unrecognized failure to unresolved', () => {
    expect(isProvenSshSessionGoneError(new Error('SOME_FUTURE_RELAY_ERROR'))).toBe(false)
  })
})

// The `reattach failure description` cases moved rather than vanished. An unproven failure no
// longer renders an error string at all — it renders the disconnected banner with two actions
// (STA-3077 step E-0), so "keeps the wire token out of the pane" is now asserted against that
// copy in TerminalPaneDisconnectedBanner.test.tsx, alongside the no-death-verbs constraint.

// An identity mismatch is the relay saying "I have this pty and its recorded
// pane differs" — proof the shell is ALIVE. It is worded "not found", so the
// not-found regex alone reads it backwards and respawns onto a live shell,
// resuming the agent a second time. Reachable by detaching a pane to a new tab.
describe('an identity mismatch is never proof of death', () => {
  it('refuses the token main publishes', () => {
    const error = new Error('SSH_PTY_IDENTITY_MISMATCH: pty-7')
    expect(isProvenSshSessionGoneError(error)).toBe(false)
  })

  // Defense in depth: any route that surfaces the relay's raw wording unwrapped
  // must not read as death either.
  it('refuses the relay wording unwrapped', () => {
    const error = new Error('PTY "pty-7" not found (identity mismatch)')
    expect(isProvenSshSessionGoneError(error)).toBe(false)
  })

  // Clause-selectivity: silencing real expiry would strand panes whose shell
  // genuinely went away.
  it('still proves death for the same wording without the mismatch clause', () => {
    expect(isProvenSshSessionGoneError(new Error('PTY "pty-7" not found'))).toBe(true)
  })
})
