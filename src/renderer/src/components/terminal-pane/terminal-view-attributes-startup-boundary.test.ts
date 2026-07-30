import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

const APP_PATH = join(process.cwd(), 'src/renderer/src/App.tsx')
const APPEARANCE_PATH = join(
  process.cwd(),
  'src/renderer/src/components/terminal-pane/terminal-appearance.ts'
)
const STARTUP_PATH = join(
  process.cwd(),
  'src/renderer/src/components/terminal-pane/terminal-view-start.ts'
)

function sourceImports(source: string): string[] {
  return [...source.matchAll(/\bfrom\s+['"]([^'"]+)['"]/g)].map((match) => match[1])
}

describe('terminal view-attributes startup source boundary', () => {
  it('routes the App startup call through the concrete startup leaf', () => {
    const appSource = readFileSync(APP_PATH, 'utf8')
    const appearanceSource = readFileSync(APPEARANCE_PATH, 'utf8')

    expect(appSource).toContain("from './components/terminal-pane/terminal-view-start'")
    expect(appSource).not.toMatch(
      /publishTerminalViewAttributesAtAppStart[^]*from '\.\/components\/terminal-pane\/terminal-appearance'/
    )
    expect(appearanceSource).not.toContain(
      'export function publishTerminalViewAttributesAtAppStart'
    )
  })

  it('keeps the startup leaf independent of pane and runtime implementations', () => {
    const startupSource = readFileSync(STARTUP_PATH, 'utf8')
    const imports = sourceImports(startupSource)
    const implementationImports = imports.filter((specifier) =>
      /pane-manager|sync-runtime-graph|terminal-pane-lifecycle|pty-(?:connection|dispatcher|transport)/.test(
        specifier
      )
    )

    expect(imports).toContain('@/lib/terminal-theme')
    expect(imports).toContain('./terminal-view-attributes-publisher')
    expect(implementationImports).toEqual([])
    expect(startupSource).not.toContain('applyTerminalAppearance')
  })
})
