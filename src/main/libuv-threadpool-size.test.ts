import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

describe('libuv threadpool size', () => {
  const original = process.env.UV_THREADPOOL_SIZE

  beforeEach(() => {
    vi.resetModules()
  })

  afterEach(() => {
    if (original === undefined) {
      delete process.env.UV_THREADPOOL_SIZE
    } else {
      process.env.UV_THREADPOOL_SIZE = original
    }
  })

  it('raises the default pool so one stalled mount cannot starve all async fs', async () => {
    delete process.env.UV_THREADPOOL_SIZE
    await import('./libuv-threadpool-size')
    expect(Number(process.env.UV_THREADPOOL_SIZE)).toBeGreaterThan(4)
  })

  it('leaves an operator-supplied size alone', async () => {
    process.env.UV_THREADPOOL_SIZE = '8'
    await import('./libuv-threadpool-size')
    expect(process.env.UV_THREADPOOL_SIZE).toBe('8')
  })
})
