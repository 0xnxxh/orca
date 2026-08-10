import { describe, expect, it, vi } from 'vitest'
import type { NodePtyModule } from './node-pty-loader'
import { createNodePtyLoader } from './node-pty-loader'

function deferred<T>(): {
  promise: Promise<T>
  resolve: (value: T) => void
} {
  let resolve!: (value: T) => void
  const promise = new Promise<T>((res) => {
    resolve = res
  })
  return { promise, resolve }
}

describe('createNodePtyLoader', () => {
  it('single-flights concurrent loads and caches success', async () => {
    const pending = deferred<NodePtyModule>()
    const module = { spawn: vi.fn() } as unknown as NodePtyModule
    const importer = vi.fn(() => pending.promise)
    const load = createNodePtyLoader(importer)

    const first = load()
    const second = load()
    expect(importer).toHaveBeenCalledOnce()

    pending.resolve(module)
    await expect(Promise.all([first, second])).resolves.toEqual([module, module])
    await expect(load()).resolves.toBe(module)
    expect(importer).toHaveBeenCalledOnce()
  })

  it('preserves an actionable failure until process restart', async () => {
    const nativeFailure = new Error('dlopen: incompatible architecture')
    const importer = vi.fn(() => Promise.reject(nativeFailure))
    const load = createNodePtyLoader(importer)

    const firstFailure = (await load().catch((error: unknown) => error)) as Error
    const secondFailure = (await load().catch((error: unknown) => error)) as Error

    expect(firstFailure).toBe(secondFailure)
    expect(firstFailure).toMatchObject({ cause: nativeFailure })
    expect(firstFailure.message).toContain('dlopen: incompatible architecture')
    expect(firstFailure.message).toContain('Restart Orca')
    expect(importer).toHaveBeenCalledOnce()
  })
})
