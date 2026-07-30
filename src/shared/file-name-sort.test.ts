import { describe, expect, it } from 'vitest'
import { compareFileNames } from './file-name-sort'

describe('compareFileNames', () => {
  it('sorts numeric name segments naturally instead of lexicographically', () => {
    const names = [
      '1 - item.txt',
      '100 - item.txt',
      '2 - item.txt',
      '200 - item.txt',
      '409 - item.txt',
      '41 - item.txt',
      '410 - item.txt',
      '9 - item.txt',
      '99 - item.txt'
    ]
    expect([...names].sort(compareFileNames)).toEqual([
      '1 - item.txt',
      '2 - item.txt',
      '9 - item.txt',
      '41 - item.txt',
      '99 - item.txt',
      '100 - item.txt',
      '200 - item.txt',
      '409 - item.txt',
      '410 - item.txt'
    ])
  })

  it('sorts embedded numbers naturally within alphabetical order', () => {
    expect(['b1.md', 'a10.md', 'a2.md', 'a1.md'].sort(compareFileNames)).toEqual([
      'a1.md',
      'a2.md',
      'a10.md',
      'b1.md'
    ])
  })
})
