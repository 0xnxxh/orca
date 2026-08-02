import { readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

// The marker sweep that found the dropped-`isComposing` adapters is blind to this defect: the
// markers are present and the guard is called, just one branch too late. An Escape that dismisses
// an IME candidate window is marked, so a handler that runs its Escape branch first discards the
// draft, resets the search, or cancels recording on a keystroke the user aimed at the IME.
//
// Ordering is a property of the source, not of any one component's behaviour, so it is pinned
// here once rather than re-tested in every composer that happens to handle Escape.

const ROOTS = ['src/renderer/src', 'src/main', 'src/shared']
const GUARD = 'isImeCompositionKeyDown'
const ESCAPE = "=== 'Escape'"

function sourceFiles(dir: string): string[] {
  const found: string[] = []
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const path = join(dir, entry.name)
    if (entry.isDirectory()) {
      if (entry.name !== 'node_modules' && entry.name !== '__snapshots__') {
        found.push(...sourceFiles(path))
      }
      continue
    }
    if (!/\.tsx?$/.test(entry.name) || /\.(test|spec)\.tsx?$/.test(entry.name)) {
      continue
    }
    found.push(path)
  }
  return found
}

// Returns the body of every keydown handler in `source`, brace-matched from its opening `{`.
function keydownHandlerBodies(source: string): string[] {
  const bodies: string[] = []
  const starts = /onKeyDown(?:Capture)?=\{|(?:function|const)\s+\w*[Kk]ey[Dd]own\w*\s*[=(]/g
  for (let match = starts.exec(source); match !== null; match = starts.exec(source)) {
    const open = source.indexOf('{', match.index + match[0].length - 1)
    if (open === -1) {
      continue
    }
    let depth = 0
    for (let i = open; i < source.length; i++) {
      if (source[i] === '{') {
        depth++
      } else if (source[i] === '}') {
        depth--
        if (depth === 0) {
          bodies.push(source.slice(open, i + 1))
          break
        }
      }
    }
  }
  return bodies
}

describe('composition guards sit above the Escape branch', () => {
  const offenders: string[] = []
  for (const root of ROOTS) {
    for (const file of sourceFiles(root)) {
      const source = readFileSync(file, 'utf8')
      if (!source.includes(GUARD) || !source.includes(ESCAPE)) {
        continue
      }
      for (const body of keydownHandlerBodies(source)) {
        const guardAt = body.indexOf(GUARD)
        const escapeAt = body.indexOf(ESCAPE)
        if (guardAt !== -1 && escapeAt !== -1 && escapeAt < guardAt) {
          offenders.push(file)
        }
      }
    }
  }

  it('finds no keydown handler that dispatches Escape before consulting the guard', () => {
    expect(offenders).toEqual([])
  })

  // Guards against the check silently matching nothing — a scanner that parses no handlers
  // would report zero offenders forever.
  it('actually scanned guarded keydown handlers', () => {
    const scanned = ROOTS.flatMap(sourceFiles).filter((file) => {
      const source = readFileSync(file, 'utf8')
      return source.includes(GUARD) && keydownHandlerBodies(source).some((b) => b.includes(GUARD))
    })
    expect(scanned.length).toBeGreaterThan(8)
  })
})
