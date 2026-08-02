import { readdirSync, readFileSync } from 'node:fs'
import { basename, join } from 'node:path'
import { describe, expect, it } from 'vitest'

const UI_DIR = 'src/renderer/src/components/ui'
const NON_DISMISSABLE_CONTENT = new Set(['accordion.tsx', 'collapsible.tsx', 'tabs.tsx'])
const MUST_GUARD = [
  'command.tsx',
  'context-menu.tsx',
  'dialog.tsx',
  'dropdown-menu.tsx',
  'hover-card.tsx',
  'popover.tsx',
  'select.tsx',
  'sheet.tsx',
  'tooltip.tsx'
]

function count(source: string, pattern: RegExp): number {
  return source.match(pattern)?.length ?? 0
}

describe('Radix dismissable-layer wrappers guard IME Escape', () => {
  it('guards every dismissable Primitive.Content exported from the UI layer', () => {
    const guarded: string[] = []
    const offenders: string[] = []

    for (const entry of readdirSync(UI_DIR, { withFileTypes: true })) {
      if (!entry.isFile() || !entry.name.endsWith('.tsx') || entry.name.includes('.test.')) {
        continue
      }
      const file = join(UI_DIR, entry.name)
      const source = readFileSync(file, 'utf8')
      const contentCount = count(source, /<\w+Primitive\.(?:Sub)?Content\b/g)
      if (contentCount === 0 || NON_DISMISSABLE_CONTENT.has(entry.name)) {
        continue
      }
      const hookCount = count(source, /const handleEscapeKeyDown = useImeAwareEscapeKeyDown\(/g)
      const propCount = count(source, /onEscapeKeyDown=\{handleEscapeKeyDown\}/g)
      if (hookCount !== contentCount || propCount !== contentCount) {
        offenders.push(basename(file))
      } else {
        guarded.push(basename(file))
      }
    }

    expect(offenders).toEqual([])
    expect(guarded).toEqual(expect.arrayContaining(MUST_GUARD))
  })
})
