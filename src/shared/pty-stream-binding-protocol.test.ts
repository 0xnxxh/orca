import { describe, expect, it } from 'vitest'
import { isPtyStreamSource } from './pty-stream-binding-protocol'

describe('PTY stream binding protocol', () => {
  it('requires both a bounded nonce and an incarnation', () => {
    expect(isPtyStreamSource({ incarnationId: 'inc-a', streamBindingNonce: 'nonce-a' })).toBe(true)
    expect(isPtyStreamSource({ incarnationId: 'inc-a', streamBindingNonce: '' })).toBe(false)
    expect(isPtyStreamSource({ incarnationId: '', streamBindingNonce: 'nonce-a' })).toBe(false)
  })
})
