import { describe, expect, it } from 'vitest'
import { DaemonPtyStreamBindingState } from './daemon-pty-stream-binding-state'

function source(incarnationId: string, streamBindingNonce: string) {
  return { incarnationId, streamBindingNonce }
}

describe('DaemonPtyStreamBindingState', () => {
  it('admits the first source marker before its control reply', () => {
    const state = new DaemonPtyStreamBindingState()
    state.begin('nonce-a')

    expect(state.acceptMarker('session-1', source('inc-a', 'nonce-a'))).toEqual(
      source('inc-a', 'nonce-a')
    )
    expect(state.sourceFor('session-1')).toEqual(source('inc-a', 'nonce-a'))
    expect(state.acceptResponse('nonce-a', 'session-1', 'inc-a', 'nonce-a')).toBe(true)
  })

  it('lets the latest ordered concurrent marker own the stream', () => {
    const state = new DaemonPtyStreamBindingState()
    state.begin('nonce-a')
    state.begin('nonce-b')

    state.acceptMarker('session-1', source('inc-a', 'nonce-a'))
    state.acceptMarker('session-1', source('inc-b', 'nonce-b'))
    expect(state.acceptResponse('nonce-a', 'session-1', 'inc-a', 'nonce-a')).toBe(true)
    expect(state.sourceFor('session-1')).toEqual(source('inc-b', 'nonce-b'))
    expect(state.acceptResponse('nonce-b', 'session-1', 'inc-b', 'nonce-b')).toBe(true)
  })

  it('rejects stale markers, output bindings, and exits', () => {
    const state = new DaemonPtyStreamBindingState()
    state.begin('nonce-current')
    state.acceptMarker('session-1', source('inc-current', 'nonce-current'))

    expect(state.acceptMarker('session-1', source('inc-stale', 'nonce-stale'))).toBeNull()
    expect(state.sourceFor('session-1')).toEqual(source('inc-current', 'nonce-current'))
    expect(state.admitsEvent('session-1')).toBe(true)
    expect(state.admitsEvent('stale-session')).toBe(false)
    expect(state.admitsExit('session-1', 'inc-stale')).toBe(false)
    expect(state.admitsExit('session-1', 'inc-current')).toBe(true)
  })

  it('revokes a marker when its final control reply disagrees', () => {
    const state = new DaemonPtyStreamBindingState()
    state.begin('nonce-a')
    state.acceptMarker('session-1', source('inc-a', 'nonce-a'))

    expect(state.acceptResponse('nonce-a', 'session-1', 'inc-b', 'nonce-a')).toBe(false)
    expect(state.sourceFor('session-1')).toBeUndefined()
  })

  it('revokes a nonce that emits conflicting source markers', () => {
    const state = new DaemonPtyStreamBindingState()
    state.begin('nonce-a')
    state.acceptMarker('session-1', source('inc-a', 'nonce-a'))

    expect(state.acceptMarker('session-2', source('inc-b', 'nonce-a'))).toBeNull()
    expect(state.sourceFor('session-1')).toBeUndefined()
    expect(state.sourceFor('session-2')).toBeUndefined()
  })

  it('bounds response-only bindings without evicting a live transaction', () => {
    const state = new DaemonPtyStreamBindingState(2)
    state.begin('nonce-a')
    state.begin('nonce-b')
    expect(state.acceptResponse('nonce-a', 'session-1', 'inc-a', 'nonce-a')).toBe(true)

    expect(() => state.begin('nonce-c')).toThrow('daemon_stream_binding_capacity_exceeded')
    expect(state.acceptMarker('session-1', source('inc-a', 'nonce-a'))).toEqual(
      source('inc-a', 'nonce-a')
    )
    expect(() => state.begin('nonce-c')).not.toThrow()
  })
})
