// @vitest-environment happy-dom
import { createElement, type ReactNode } from 'react'
import { renderHook } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import * as contextModule from '@/components/confirmation-dialog-context'
import * as providerModule from '@/components/confirmation-dialog'
import { ConfirmationDialogProvider } from '@/components/confirmation-dialog'
import { useConfirmationDialog } from '@/components/confirmation-dialog-context'

// Why: crash reports 42d63029 / 5ee3b8b6. A module exporting both the provider and
// the hook is not a Fast Refresh boundary, so Vite applied its updates in two passes
// under two `?t=` stamps, `createContext` ran twice, and the provider published a
// different context object than `ChecksPanel` read. Asserting on the *module
// namespace* rather than source text is what makes re-exports and default exports
// visible here -- `export { useConfirmationDialog } from ...` reintroduces the crash
// and no amount of source-shape regex sees it.
function isComponentLike(value: unknown): boolean {
  if (typeof value === 'function') {
    return /^[A-Z]/.test(value.name)
  }
  if (typeof value === 'object' && value !== null) {
    const tag = (value as { $$typeof?: symbol }).$$typeof
    return tag === Symbol.for('react.forward_ref') || tag === Symbol.for('react.memo')
  }
  return false
}

function nonComponentExports(moduleNamespace: object): string[] {
  return Object.entries(moduleNamespace)
    .filter(([, value]) => !isComponentLike(value))
    .map(([name]) => name)
}

describe('confirmation dialog Fast Refresh boundary', () => {
  it('exports only components from the provider module', () => {
    expect(Object.keys(providerModule).length).toBeGreaterThan(0)
    expect(nonComponentExports(providerModule)).toEqual([])
  })

  it('keeps the context and hook in a component-free module', () => {
    const components = Object.entries(contextModule)
      .filter(([, value]) => isComponentLike(value))
      .map(([name]) => name)

    expect(components).toEqual([])
    expect(typeof contextModule.useConfirmationDialog).toBe('function')
  })

  it('resolves the hook against the context the provider publishes', () => {
    const wrapper = ({ children }: { children: ReactNode }) =>
      createElement(ConfirmationDialogProvider, null, children)
    const { result } = renderHook(() => useConfirmationDialog(), { wrapper })

    expect(typeof result.current).toBe('function')
  })
})
