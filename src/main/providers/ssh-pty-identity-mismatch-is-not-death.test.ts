/**
 * An identity mismatch means the relay FOUND the PTY and its recorded pane
 * differs — the shell is running. Publishing that as expiry makes the renderer
 * clear the binding and cold-restore with agent resume, which is a second agent
 * on one transcript while the first keeps running.
 *
 * Reachable today from a shipped gesture: detaching a pane into a new tab
 * changes tabId, the relay still holds the tabId frozen at spawn, and the
 * reattach mismatches.
 *
 * Pins the PRODUCER and the CONSUMERS together. The two guards this program
 * shipped before both passed while sitting off the route production takes, so
 * asserting the classifier alone is not enough — the destructive token has to
 * be absent from what the reattach actually throws.
 */
import { describe, expect, it, vi } from 'vitest'
import { reattachSshPtySession } from './ssh-pty-session-reattach'
import {
  SSH_SESSION_EXPIRED_ERROR,
  SSH_PTY_IDENTITY_MISMATCH_ERROR
} from '../../shared/ssh-pty-failure-tokens'

/** The renderer converts a failure into `sessionExpired: true` on these tokens
 *  and then respawns on the flag alone, never consulting the classifier.
 *  Mirrors pty-transport.ts. */
const SSH_PTY_CONNECTION_MISMATCH_MARKER = 'belongs to SSH connection'
function transportWouldReportSessionExpired(message: string): boolean {
  return (
    message.includes(SSH_SESSION_EXPIRED_ERROR) ||
    message.includes(SSH_PTY_CONNECTION_MISMATCH_MARKER)
  )
}

const CONNECTION_ID = 'ssh-target-1'
const RELAY_PTY_ID = 'pty-7'

function muxThatFailsAttachWith(message: string): { mux: unknown } {
  return {
    mux: {
      request: vi.fn().mockRejectedValue(new Error(message)),
      notify: vi.fn()
    }
  }
}

async function reattachError(attachFailure: string): Promise<Error> {
  const { mux } = muxThatFailsAttachWith(attachFailure)
  try {
    await reattachSshPtySession({
      mux: mux as never,
      connectionId: CONNECTION_ID,
      sessionId: RELAY_PTY_ID,
      options: { cols: 80, rows: 24, paneKey: 'tab-new:leaf-1', tabId: 'tab-new' } as never
    })
  } catch (error) {
    return error as Error
  }
  throw new Error('reattach unexpectedly succeeded')
}

describe('an identity mismatch is not a death', () => {
  it('does not publish the destructive expiry token', async () => {
    const error = await reattachError(`PTY "${RELAY_PTY_ID}" not found (identity mismatch)`)

    expect(error.message).not.toContain(SSH_SESSION_EXPIRED_ERROR)
  })

  // The renderer keys off this token; its own clauses live beside the
  // classifier, in reattach-failure-classification.test.ts.
  it('marks the failure with the shared mismatch token', async () => {
    const error = await reattachError(`PTY "${RELAY_PTY_ID}" not found (identity mismatch)`)

    expect(error.message).toContain(SSH_PTY_IDENTITY_MISMATCH_ERROR)
  })

  // The flag path bypasses the classifier entirely, so it needs its own clause.
  it('does not trip the renderer transport into sessionExpired', async () => {
    const error = await reattachError(`PTY "${RELAY_PTY_ID}" not found (identity mismatch)`)

    expect(transportWouldReportSessionExpired(error.message)).toBe(false)
  })
})

describe('a genuine absence is still a death', () => {
  // Clause-selectivity: a fix that silences real expiry would strand panes on a
  // shell that truly went away, so the contrast has to hold.
  it('still publishes expiry when the relay simply has no such PTY', async () => {
    const error = await reattachError(`PTY "${RELAY_PTY_ID}" not found`)

    expect(error.message).toContain(SSH_SESSION_EXPIRED_ERROR)
    expect(error.message).not.toContain(SSH_PTY_IDENTITY_MISMATCH_ERROR)
    expect(transportWouldReportSessionExpired(error.message)).toBe(true)
  })

  it('leaves an unrelated failure untouched rather than guessing', async () => {
    const error = await reattachError('ECONNRESET while writing to the relay')

    expect(error.message).not.toContain(SSH_SESSION_EXPIRED_ERROR)
    expect(error.message).not.toContain(SSH_PTY_IDENTITY_MISMATCH_ERROR)
  })
})
