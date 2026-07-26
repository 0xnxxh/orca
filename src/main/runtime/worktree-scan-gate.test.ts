import { describe, expect, it, vi } from 'vitest'
import { WorktreeScanGate } from './worktree-scan-gate'

function deferred<T>() {
  let resolve!: (value: T) => void
  let reject!: (error: Error) => void
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise
    reject = rejectPromise
  })
  return { promise, resolve, reject }
}

describe('WorktreeScanGate', () => {
  it('bounds active operations and starts queued work in FIFO order', async () => {
    const gate = new WorktreeScanGate(2)
    const first = deferred<number>()
    const second = deferred<number>()
    const starts: number[] = []
    const run = (id: number, result: Promise<number>) =>
      gate.run(() => {
        starts.push(id)
        return { result }
      })

    const calls = [run(1, first.promise), run(2, second.promise), run(3, Promise.resolve(3))]
    await vi.waitFor(() => expect(starts).toEqual([1, 2]))
    first.resolve(1)
    await vi.waitFor(() => expect(starts).toEqual([1, 2, 3]))
    second.resolve(2)

    await expect(Promise.all(calls)).resolves.toEqual([1, 2, 3])
  })

  it('removes a queued acquisition when its caller aborts', async () => {
    const gate = new WorktreeScanGate(1)
    const active = deferred<number>()
    const controller = new AbortController()
    const first = gate.run(() => ({ result: active.promise }))
    const queued = gate.run(() => ({ result: Promise.resolve(2) }), controller.signal)

    controller.abort()
    await expect(queued).rejects.toMatchObject({ name: 'AbortError' })
    active.resolve(1)
    await expect(first).resolves.toBe(1)
  })

  it('retains a permit until resource settlement after the result rejects', async () => {
    const gate = new WorktreeScanGate(1)
    const settled = deferred<void>()
    const starts: number[] = []
    const first = gate.run(() => {
      starts.push(1)
      return { result: Promise.reject(new Error('timed out')), settled: settled.promise }
    })
    const second = gate.run(() => {
      starts.push(2)
      return { result: Promise.resolve(2) }
    })

    await expect(first).rejects.toThrow('timed out')
    expect(starts).toEqual([1])
    settled.resolve()
    await expect(second).resolves.toBe(2)
  })
})
