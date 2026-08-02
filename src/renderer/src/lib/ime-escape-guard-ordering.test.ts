import { readdirSync, readFileSync } from 'node:fs'
import { join, sep } from 'node:path'
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
const MUST_SCAN = [
  'src/renderer/src/components/native-chat/use-native-chat-composer-keydown.ts',
  'src/renderer/src/components/new-workspace/SmartWorkspaceNameField.tsx',
  'src/renderer/src/components/settings/ShortcutRecorderButton.tsx'
]

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

// A body brace never follows `(`, `,`, `:` or `=`; those introduce a destructured parameter list,
// a JSX expression container, or an object type — all of which open with `{` and would otherwise
// be brace-matched in place of the body. Returns -1 for a handler passed by name, where the
// expression closes before any body opens.
function bodyBrace(source: string, from: number): number {
  let skipped = 0
  for (let i = from; i < source.length; i++) {
    if (source[i] === '{') {
      let before = i - 1
      while (before >= 0 && /\s/.test(source[before])) {
        before--
      }
      if (!'(,:='.includes(source[before])) {
        return i
      }
      skipped++
      continue
    }
    if (source[i] === '}') {
      if (skipped === 0) {
        return -1
      }
      skipped--
    }
  }
  return -1
}

// Returns the body of every keydown handler in `source`, brace-matched from its opening `{`.
function keydownHandlerBodies(source: string): string[] {
  const bodies: string[] = []
  const starts = /onKeyDown(?:Capture)?=\{|(?:function|const)\s+\w*[Kk]ey[Dd]own\w*\s*[=(]/g
  for (let match = starts.exec(source); match !== null; match = starts.exec(source)) {
    const open = bodyBrace(source, match.index + match[0].length)
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

  // A scanner that parses nothing reports zero offenders forever, so the coverage it claims is
  // asserted by name. MUST_SCAN holds the handler shapes the brace matcher has actually got wrong:
  // a hook whose destructured parameter list opens before its body, an inline JSX arrow, and a
  // named callback. A parser regression fails here naming the file it stopped seeing.
  it('actually scanned the guarded keydown handlers it claims to cover', () => {
    const scanned = ROOTS.flatMap(sourceFiles)
      .filter((file) => {
        const source = readFileSync(file, 'utf8')
        return source.includes(GUARD) && keydownHandlerBodies(source).some((b) => b.includes(GUARD))
      })
      .map((file) => file.split(sep).join('/'))

    expect(scanned).toEqual(expect.arrayContaining(MUST_SCAN))
    expect(scanned.length).toBeGreaterThan(8)
  })
})
