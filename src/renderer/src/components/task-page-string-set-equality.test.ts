import { describe, expect, it } from 'vitest'

import { areStringSetsEqual } from './task-page-string-set-equality'

describe('areStringSetsEqual', () => {
  it('treats two empty sets as equal', () => {
    expect(areStringSetsEqual(new Set(), new Set())).toBe(true)
  })

  it('ignores insertion order', () => {
    expect(areStringSetsEqual(new Set(['a', 'b']), new Set(['b', 'a']))).toBe(true)
  })

  it('rejects differing sizes', () => {
    expect(areStringSetsEqual(new Set(['a']), new Set(['a', 'b']))).toBe(false)
    expect(areStringSetsEqual(new Set(['a', 'b']), new Set(['a']))).toBe(false)
  })

  it('rejects same-size sets with different members', () => {
    expect(areStringSetsEqual(new Set(['a', 'b']), new Set(['a', 'c']))).toBe(false)
  })

  it('compares by exact string identity', () => {
    expect(areStringSetsEqual(new Set(['A']), new Set(['a']))).toBe(false)
    expect(areStringSetsEqual(new Set(['']), new Set(['']))).toBe(true)
  })
})
