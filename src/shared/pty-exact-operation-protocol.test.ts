import { describe, expect, it } from 'vitest'
import { matchesPtyExactOperationIdentity } from './pty-exact-operation-protocol'

describe('PTY exact operation protocol', () => {
  it('matches only a present current incarnation', () => {
    expect(matchesPtyExactOperationIdentity('inc-a', 'inc-a')).toBe(true)
    expect(matchesPtyExactOperationIdentity('inc-a', 'inc-b')).toBe(false)
    expect(matchesPtyExactOperationIdentity(undefined, 'inc-a')).toBe(false)
  })
})
