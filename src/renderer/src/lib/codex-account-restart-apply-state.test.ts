import { describe, expect, it } from 'vitest'
import { resolveCodexAccountRestartApplyState } from './codex-account-restart-apply-state'

describe('resolveCodexAccountRestartApplyState', () => {
  it('rejects a PTY generation replaced on the same transport during preparation', () => {
    let ptyId = 'pty-old'
    const transport = { getPtyId: (): string => ptyId }
    ptyId = 'pty-new'

    expect(
      resolveCodexAccountRestartApplyState({
        capturedTransport: transport,
        currentTransport: transport,
        capturedPtyId: 'pty-old',
        capturedHostAccountId: 'account-b',
        currentHostAccountId: 'account-b'
      })
    ).toBe('target-replaced')
  })

  it('retries when the selected account changes during preparation', () => {
    const transport = { getPtyId: (): string => 'pty-1' }

    expect(
      resolveCodexAccountRestartApplyState({
        capturedTransport: transport,
        currentTransport: transport,
        capturedPtyId: 'pty-1',
        capturedHostAccountId: 'account-b',
        currentHostAccountId: 'account-c'
      })
    ).toBe('selection-changed')
  })
})
