import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({ walk: vi.fn() }))

vi.mock('../ai-vault/session-scanner-discovery', () => ({
  walkSessionFiles: mocks.walk
}))

import { findWslCodexSessionPath } from './wsl-codex-session-path-scan'

function deferred<T>(): { promise: Promise<T>; resolve: (value: T) => void } {
  let resolve!: (value: T) => void
  return { promise: new Promise<T>((res) => (resolve = res)), resolve }
}

beforeEach(() => {
  mocks.walk.mockReset()
})

describe('WSL Codex session path scans', () => {
  it('shares one root snapshot across concurrent session ids', async () => {
    const scan = deferred<string[]>()
    mocks.walk.mockReturnValue(scan.promise)

    const first = findWslCodexSessionPath('\\\\wsl.localhost\\Ubuntu\\sessions', 'first')
    const second = findWslCodexSessionPath('\\\\wsl.localhost\\Ubuntu\\sessions', 'second')
    scan.resolve([
      '\\\\wsl.localhost\\Ubuntu\\sessions\\rollout-first.jsonl',
      '\\\\wsl.localhost\\Ubuntu\\sessions\\rollout-second.jsonl'
    ])

    await expect(Promise.all([first, second])).resolves.toEqual([
      '\\\\wsl.localhost\\Ubuntu\\sessions\\rollout-first.jsonl',
      '\\\\wsl.localhost\\Ubuntu\\sessions\\rollout-second.jsonl'
    ])
    expect(mocks.walk).toHaveBeenCalledOnce()
  })

  it('refreshes a shared miss so post-start file creation is visible', async () => {
    const initial = deferred<string[]>()
    mocks.walk
      .mockReturnValueOnce(initial.promise)
      .mockResolvedValueOnce(['\\\\wsl.localhost\\Ubuntu\\sessions\\2026\\rollout-created.jsonl'])

    const initialCaller = findWslCodexSessionPath('\\\\wsl.localhost\\Ubuntu\\sessions', 'absent')
    const laterCaller = findWslCodexSessionPath('\\\\wsl.localhost\\Ubuntu\\sessions', 'created')
    initial.resolve([])

    await expect(initialCaller).resolves.toBeNull()
    await expect(laterCaller).resolves.toBe(
      '\\\\wsl.localhost\\Ubuntu\\sessions\\2026\\rollout-created.jsonl'
    )
    expect(mocks.walk).toHaveBeenCalledTimes(2)
  })

  it('aborts an abandoned scan when its final waiter closes', async () => {
    let scanSignal: AbortSignal | undefined
    mocks.walk.mockImplementation(
      (_root: string, _agent: string, _issues: unknown[], options: { signal?: AbortSignal }) => {
        scanSignal = options.signal
        return new Promise<string[]>((_resolve, reject) => {
          options.signal?.addEventListener('abort', () => reject(options.signal?.reason), {
            once: true
          })
        })
      }
    )
    const controller = new AbortController()
    const scan = findWslCodexSessionPath(
      '\\\\wsl.localhost\\Ubuntu\\sessions',
      'closed',
      controller.signal
    )

    controller.abort(new Error('closed'))
    await expect(scan).rejects.toThrow('closed')
    expect(scanSignal?.aborted).toBe(true)
  })
})
