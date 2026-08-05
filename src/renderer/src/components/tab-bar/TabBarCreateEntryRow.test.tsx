// @vitest-environment happy-dom

import { act, createElement } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { ActiveOption } from './tab-create-entry-active-option'

import { EntryActionRow } from './TabBarCreateEntryRow'

;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

const filePath = 'app/src/components/SecondaryNav.tsx'

function makeFileOption(path: string): ActiveOption {
  return {
    kind: 'entry',
    option: {
      id: `existing-file:${path}`,
      classification: {
        kind: 'existing-file',
        matchKind: 'fuzzy',
        relativePath: path
      }
    }
  }
}

let container: HTMLDivElement
let root: Root

beforeEach(() => {
  container = document.createElement('div')
  document.body.appendChild(container)
  root = createRoot(container)
})

afterEach(() => {
  act(() => root.unmount())
  container.remove()
})

describe('EntryActionRow', () => {
  it('puts the filename before the truncated parent path and exposes the full path in a native tooltip', () => {
    act(() => {
      root.render(
        createElement(EntryActionRow, {
          id: 'file-result',
          onClick: vi.fn(),
          option: makeFileOption(filePath),
          selected: true
        })
      )
    })

    const button = container.querySelector('button')
    const text = button?.textContent ?? ''
    expect(text.indexOf('SecondaryNav.tsx')).toBeLessThan(text.indexOf('app/src/components/'))
    expect(button?.getAttribute('title')).toBe(filePath)
  })

  it('does not duplicate the root separator for absolute root-level files', () => {
    act(() => {
      root.render(
        createElement(EntryActionRow, {
          id: 'root-file-result',
          onClick: vi.fn(),
          option: makeFileOption('/foo'),
          selected: false
        })
      )
    })

    expect(container.querySelector('button')?.textContent).toContain('foo/')
    expect(container.querySelector('button')?.textContent).not.toContain('foo//')
  })
})
