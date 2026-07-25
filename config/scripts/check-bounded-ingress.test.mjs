import { describe, expect, it } from 'vitest'
import { findViolations, violationKey } from './check-bounded-ingress.mjs'

describe('check-bounded-ingress', () => {
  it('flags an unbounded file read and JSON parse', () => {
    const found = findViolations(
      'src/main/thing.ts',
      ['const buf = await readFile(p)', 'return JSON.parse(buf.toString())'].join('\n')
    )
    expect(found.map((v) => v.id)).toEqual(['read-file', 'json-parse'])
    expect(found[0].line).toBe(1)
  })

  it('honors a bounded-by justification on the line and the line above', () => {
    const sameLine = findViolations(
      'src/main/thing.ts',
      'const buf = await readFile(p) // bounded-by: fixture path under 1KB'
    )
    const lineAbove = findViolations(
      'src/main/thing.ts',
      ['// bounded-by: size checked by the caller', 'const buf = await readFile(p)'].join('\n')
    )
    expect(sameLine).toEqual([])
    expect(lineAbove).toEqual([])
  })

  it('flags unbounded response bodies and fan-out', () => {
    const found = findViolations(
      'src/main/thing.ts',
      ['const body = await response.text()', 'await Promise.all(items.map((i) => load(i)))'].join(
        '\n'
      )
    )
    expect(found.map((v) => v.id)).toEqual(['response-text', 'unbounded-fanout'])
  })

  it('keys violations by file and rule so a baseline survives line moves', () => {
    expect(violationKey({ file: 'src/a.ts', id: 'read-file', line: 12 })).toBe('src/a.ts:read-file')
    expect(violationKey({ file: 'src/a.ts', id: 'read-file', line: 99 })).toBe('src/a.ts:read-file')
  })

  it('ignores lines with no ingress pattern', () => {
    expect(findViolations('src/main/thing.ts', 'const total = a + b')).toEqual([])
  })
})
