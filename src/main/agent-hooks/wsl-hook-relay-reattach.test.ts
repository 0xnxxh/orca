import { describe, expect, it, vi } from 'vitest'

import {
  ensureWslHookRelayForReattach,
  WSL_HOOK_RELAY_REATTACH_FAIL_OPEN_MS
} from './wsl-hook-relay-reattach'

describe('ensureWslHookRelayForReattach', () => {
  it('refreshes the surviving session distro after a local reattach', async () => {
    const ensure = vi.fn()

    await ensureWslHookRelayForReattach(
      { isReattach: true, wslDistro: 'Ubuntu-24.04' },
      null,
      ensure
    )

    expect(ensure).toHaveBeenCalledOnce()
    expect(ensure).toHaveBeenCalledWith('Ubuntu-24.04')
  })

  it.each([
    ['fresh WSL spawn', { wslDistro: 'Ubuntu' }, null],
    ['native reattach', { isReattach: true, wslDistro: null }, null],
    ['legacy reattach without ownership context', { isReattach: true }, null],
    ['blank distro', { isReattach: true, wslDistro: '  ' }, null],
    ['SSH reattach', { isReattach: true, wslDistro: 'Ubuntu' }, 'ssh-1'],
    ['relay reattach', { isReattach: true, wslDistro: 'Ubuntu' }, 'relay-1']
  ])('does not refresh a %s', async (_label, result, connectionId) => {
    const ensure = vi.fn()

    await ensureWslHookRelayForReattach(result, connectionId, ensure)

    expect(ensure).not.toHaveBeenCalled()
  })

  it('preserves exact distro ownership across multiple local reattachments', async () => {
    const ensure = vi.fn()

    await ensureWslHookRelayForReattach({ isReattach: true, wslDistro: 'Ubuntu' }, null, ensure)
    await ensureWslHookRelayForReattach({ isReattach: true, wslDistro: 'Debian' }, null, ensure)

    expect(ensure.mock.calls).toEqual([['Ubuntu'], ['Debian']])
  })

  it('awaits relay readiness only for the reattached WSL session', async () => {
    let release!: () => void
    const ensure = vi.fn(() => new Promise<void>((resolve) => (release = resolve)))
    let ready = false

    const reattach = ensureWslHookRelayForReattach(
      { isReattach: true, wslDistro: 'Ubuntu' },
      null,
      ensure
    ).then(() => {
      ready = true
    })
    await new Promise((resolve) => setImmediate(resolve))
    expect(ready).toBe(false)

    release()
    await reattach
    expect(ready).toBe(true)
  })

  it('fails open a WSL reattach when optional relay readiness stalls', async () => {
    vi.useFakeTimers()
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    try {
      const reattach = ensureWslHookRelayForReattach(
        { isReattach: true, wslDistro: 'Ubuntu' },
        null,
        () => new Promise<void>(() => {})
      )
      await vi.advanceTimersByTimeAsync(WSL_HOOK_RELAY_REATTACH_FAIL_OPEN_MS)
      await expect(reattach).resolves.toBeUndefined()
      expect(warn).toHaveBeenCalledWith(expect.stringContaining('timed out'))
      expect(vi.getTimerCount()).toBe(0)
    } finally {
      warn.mockRestore()
      vi.useRealTimers()
    }
  })

  it('fails open a WSL reattach when relay readiness rejects', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    try {
      await expect(
        ensureWslHookRelayForReattach({ isReattach: true, wslDistro: 'Ubuntu' }, null, () =>
          Promise.reject(new Error('relay failed'))
        )
      ).resolves.toBeUndefined()
      expect(warn).toHaveBeenCalledWith(
        expect.stringContaining('reattach failed'),
        expect.any(Error)
      )
    } finally {
      warn.mockRestore()
    }
  })
})
