import { describe, expect, it } from 'vitest'
import { DaemonDroppedWriteBuffer } from './daemon-dropped-write-buffer'

describe('DaemonDroppedWriteBuffer', () => {
  it('preserves per-session order while coalescing recovery writes', () => {
    const buffer = new DaemonDroppedWriteBuffer()

    expect(buffer.enqueue('one', 'a')).toBe(true)
    expect(buffer.enqueue('two', 'x')).toBe(true)
    expect(buffer.enqueue('one', 'b')).toBe(true)

    expect(buffer.drain()).toEqual([
      { sessionId: 'one', data: 'ab' },
      { sessionId: 'two', data: 'x' }
    ])
    expect(buffer.hasWrites).toBe(false)
  })

  it('caps retained input across sessions', () => {
    const buffer = new DaemonDroppedWriteBuffer()

    expect(buffer.enqueue('one', 'a'.repeat(64 * 1024))).toBe(true)
    expect(buffer.enqueue('two', 'b')).toBe(false)
    expect(buffer.drain()).toEqual([{ sessionId: 'one', data: 'a'.repeat(64 * 1024) }])
  })

  it('releases a removed session budget', () => {
    const buffer = new DaemonDroppedWriteBuffer()

    expect(buffer.enqueue('one', '😀'.repeat(16 * 1024))).toBe(true)
    buffer.delete('one')

    expect(buffer.enqueue('two', 'b'.repeat(64 * 1024))).toBe(true)
  })

  it('bounds the number of replay RPCs without blocking an admitted session', () => {
    const buffer = new DaemonDroppedWriteBuffer()

    for (let index = 0; index < 256; index += 1) {
      expect(buffer.enqueue(`session-${index}`, 'a')).toBe(true)
    }
    expect(buffer.enqueue('overflow', 'b')).toBe(false)
    expect(buffer.enqueue('session-0', 'c')).toBe(true)
    expect(buffer.drain()).toHaveLength(256)
  })
})
