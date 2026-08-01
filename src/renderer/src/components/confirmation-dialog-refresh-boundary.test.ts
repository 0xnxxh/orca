import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

const COMPONENT_ROOT = __dirname
const CONTEXT_MODULE = 'confirmation-dialog-context.ts'
const PROVIDER_MODULE = 'confirmation-dialog.tsx'

function componentSource(relativePath: string): string {
  return readFileSync(join(COMPONENT_ROOT, relativePath), 'utf8')
}

// Why: `@vitejs/plugin-react` only attaches its HMR footer when the refresh
// transform emitted a `$RefreshReg$` call, and the transform registers exactly
// the capitalized bindings initialized to a function. Mirroring that heuristic
// is what makes the assertions below track the real boundary decision.
const FUNCTION_INITIALIZER =
  /^(?:async\s+)?(?:\(|function\b|[A-Za-z_$][\w$]*\s*=>|memo\(|forwardRef\()/

function componentExports(source: string): string[] {
  const names: string[] = []
  for (const [, name] of source.matchAll(/^export\s+(?:async\s+)?function\s+(\w+)/gm)) {
    names.push(name)
  }
  for (const [, name] of source.matchAll(/^export\s+class\s+(\w+)/gm)) {
    names.push(name)
  }
  for (const [, name, initializer] of source.matchAll(
    /^export\s+(?:const|let|var)\s+(\w+)\s*(?::[^=\n]+)?=\s*(.*)$/gm
  )) {
    if (FUNCTION_INITIALIZER.test(initializer)) {
      names.push(name)
    }
  }
  return names.filter((name) => /^[A-Z]/.test(name))
}

function valueExports(source: string): string[] {
  const names: string[] = []
  for (const [, name] of source.matchAll(
    /^export\s+(?:(?:async\s+)?function|class|const|let|var)\s+(\w+)/gm
  )) {
    names.push(name)
  }
  return names
}

describe('confirmation dialog Fast Refresh boundary', () => {
  // Why: crash reports 42d63029 / 5ee3b8b6. A module exporting both the provider
  // and the hook can never be a refresh boundary, so Vite applied its updates in
  // two passes under two `?t=` stamps, `createContext` ran twice, and the
  // provider published a different context object than `ChecksPanel` read.
  it('keeps the context in a component-free module', () => {
    const source = componentSource(CONTEXT_MODULE)

    expect(componentExports(source)).toEqual([])
    expect(valueExports(source)).toContain('useConfirmationDialog')
    expect(valueExports(source)).toContain('ConfirmationDialogContext')
    expect(source).toContain('createContext<ConfirmationDialogContextValue | null>(null)')
  })

  it('exports only components from the provider module', () => {
    const source = componentSource(PROVIDER_MODULE)

    expect(valueExports(source)).toEqual(['ConfirmationDialogProvider'])
    expect(componentExports(source)).toEqual(['ConfirmationDialogProvider'])
  })

  it('reads the shared context rather than creating a second one', () => {
    const source = componentSource(PROVIDER_MODULE)

    expect(source).not.toContain('createContext')
    expect(source).toContain("from '@/components/confirmation-dialog-context'")
    expect(source).toContain('<ConfirmationDialogContext.Provider value={confirm}>')
  })
})
