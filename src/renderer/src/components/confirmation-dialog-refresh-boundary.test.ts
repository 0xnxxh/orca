// @vitest-environment happy-dom
import { createRequire } from 'node:module'
import { createElement, type ReactNode } from 'react'
import { renderHook } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import * as contextModule from '@/components/confirmation-dialog-context'
import * as providerModule from '@/components/confirmation-dialog'
import { ConfirmationDialogProvider } from '@/components/confirmation-dialog'
import { useConfirmationDialog } from '@/components/confirmation-dialog-context'

// Why: crash reports 42d63029 / 5ee3b8b6. A module exporting both the provider and the
// hook is not a Fast Refresh boundary, so Vite applied its updates in two passes under two
// `?t=` stamps, `createContext` ran twice, and the provider published a different context
// object than `ChecksPanel` read.
//
// Two earlier versions of this test were evaded, both by approximating the runtime instead
// of asking it. Matching source text missed a re-export of the hook; a hand-rolled `^[A-Z]`
// name check called `export class ConfirmationDialogQueue {}` a component when the runtime
// rejects it. Hence the real predicate below rather than a third approximation.

// react-refresh ships no types; take the one binding this needs.
const { isLikelyComponentType } = createRequire(import.meta.url)('react-refresh/runtime') as {
  isLikelyComponentType: (value: unknown) => boolean
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return (
    Object.prototype.toString.call(value) === '[object Object]' &&
    ((value as object).constructor === Object || (value as object).constructor === undefined)
  )
}

// Mirrors `isCompoundComponent` in @vitejs/plugin-react's refresh-runtime, which accepts a
// plain object whose every member is a component (`export const Dialog = { Root, Trigger }`).
// The runtime's third accept term, `prevExports[key] === nextExports[key]`, is deliberately
// left out: it holds only for exports whose identity survives a re-execution, which nothing
// but a primitive does, and an unchanged primitive breaks the boundary the moment it changes.
function isRefreshSafeExport(value: unknown): boolean {
  if (isLikelyComponentType(value)) {
    return true
  }
  if (!isPlainObject(value)) {
    return false
  }
  return Object.values(value).every((member) => isLikelyComponentType(member))
}

function unsafeExports(moduleNamespace: object): string[] {
  return Object.entries(moduleNamespace)
    .filter(([, value]) => !isRefreshSafeExport(value))
    .map(([name]) => name)
}

describe('confirmation dialog Fast Refresh boundary', () => {
  it('exports nothing from the provider module that invalidates the refresh boundary', () => {
    expect(Object.keys(providerModule).length).toBeGreaterThan(0)
    expect(unsafeExports(providerModule)).toEqual([])
  })

  it('keeps the context and hook in a component-free module', () => {
    const components = Object.entries(contextModule)
      .filter(([, value]) => isLikelyComponentType(value))
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
