import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { SSH_CONNECT_UI_TIMEOUT_MS, withUiConnectTimeout } from './ssh-connect-ui-timeout'

vi.mock('@/i18n/i18n', () => ({
  translate: (_key: string, fallback: string) => fallback
}))

describe('withUiConnectTimeout', () => {
  beforeEach(() => {
    vi.useFakeTimers()
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('passes a resolved connect state straight through', async () => {
    await expect(withUiConnectTimeout(Promise.resolve('connected'))).resolves.toBe('connected')
  })

  it('propagates the connect rejection rather than the timeout message', async () => {
    const failing = withUiConnectTimeout(Promise.reject(new Error('Passphrase rejected')))

    await expect(failing).rejects.toThrow('Passphrase rejected')
  })

  // Why: ssh.connect has no timeout of its own, so a stalled backend would otherwise leave
  // the control disabled with a spinner forever.
  it('rejects a stalled connect once the UI budget elapses', async () => {
    const stalled = withUiConnectTimeout(new Promise(() => {}))
    const assertion = expect(stalled).rejects.toThrow(/Connection timed out/)

    await vi.advanceTimersByTimeAsync(SSH_CONNECT_UI_TIMEOUT_MS)

    await assertion
  })

  it('clears the timer when the connect settles first, leaving no pending work', async () => {
    await withUiConnectTimeout(Promise.resolve('connected'))

    expect(vi.getTimerCount()).toBe(0)
  })
})
