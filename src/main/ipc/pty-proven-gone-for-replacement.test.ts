/**
 * `isPtyProvenGoneForReplacement` decides whether a failure authorizes destroying a pane's shell
 * and spawning a replacement. It had no test, and an always-false id comparison shipped through
 * two review rounds because of it — the relay names a PTY by its RELAY id while the caller holds
 * the APP-scoped one.
 */
import { describe, expect, it } from 'vitest'
import { isPtyProvenGoneForReplacement } from './pty'
import { formatPtyExitedError, SSH_SESSION_EXPIRED_ERROR } from '../../shared/ssh-pty-failure-tokens'
import { toAppSshPtyId } from '../../shared/ssh-pty-id'

const TARGET = 'ssh-target-1'
const RELAY_PTY = 'pty-7'
const APP_PTY = toAppSshPtyId(TARGET, RELAY_PTY)
const INCARNATION = '6f1c9a2e-7b4d-4e1a-9c8f-2d5e6a7b8c90'

describe('what authorizes replacing a remote shell', () => {
  it('accepts the expiry the reattach mints after verifying the proof', () => {
    expect(
      isPtyProvenGoneForReplacement(new Error(`boom ${SSH_SESSION_EXPIRED_ERROR}`), APP_PTY)
    ).toBe(true)
  })

  // The regression: the relay formats the relay-scoped id, so comparing the app-scoped id was
  // always false and every un-attested exit read as "not proven" — stranding the pane.
  it('accepts a raw exit proof that names this shell by its relay id', () => {
    expect(
      isPtyProvenGoneForReplacement(
        new Error(formatPtyExitedError(RELAY_PTY, 0, INCARNATION)),
        APP_PTY
      )
    ).toBe(true)
  })

  it('refuses a raw exit proof about a different shell', () => {
    expect(
      isPtyProvenGoneForReplacement(
        new Error(formatPtyExitedError('pty-9', 0, INCARNATION)),
        APP_PTY
      )
    ).toBe(false)
  })

  it('refuses a bare not-found, which never proves a shell exited', () => {
    expect(isPtyProvenGoneForReplacement(new Error(`PTY "${RELAY_PTY}" not found`), APP_PTY)).toBe(
      false
    )
  })
})
