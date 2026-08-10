// @vitest-environment happy-dom
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { WorkspaceCleanupSortState } from '../../../../shared/workspace-cleanup-filter-model'
import { WorkspaceCleanupSortHeader } from './workspace-cleanup-sort-header'

let root: Root | null = null
let container: HTMLDivElement | null = null

function render(sort: WorkspaceCleanupSortState, handlers: Record<string, unknown> = {}): void {
  act(() =>
    root?.render(
      <WorkspaceCleanupSortHeader
        sort={sort}
        selectableCount={3}
        selectedCount={0}
        onToggleSortField={vi.fn()}
        onSetSort={vi.fn()}
        onToggleSelectAll={vi.fn()}
        {...handlers}
      />
    )
  )
}

function header(field: string): HTMLButtonElement | null {
  return container?.querySelector<HTMLButtonElement>(`[data-sort-field="${field}"]`) ?? null
}

describe('WorkspaceCleanupSortHeader', () => {
  beforeEach(() => {
    container = document.createElement('div')
    document.body.appendChild(container)
    root = createRoot(container)
  })

  afterEach(() => {
    if (root) {
      act(() => root?.unmount())
    }
    container?.remove()
    root = null
    container = null
  })

  it('marks the active sort column', () => {
    render({ field: 'size', direction: 'desc' })

    expect(header('size')?.getAttribute('aria-pressed')).toBe('true')
    expect(header('name')?.getAttribute('aria-pressed')).toBe('false')
  })

  it('routes a column click through the sort toggle', () => {
    const onToggleSortField = vi.fn()
    render({ field: 'last-activity', direction: 'asc' }, { onToggleSortField })

    act(() => header('repo')?.click())

    expect(onToggleSortField).toHaveBeenCalledWith('repo')
  })

  it('select-all reads the query result rather than the rendered page', () => {
    const onToggleSelectAll = vi.fn()
    render({ field: 'name', direction: 'asc' }, { onToggleSelectAll })

    const checkbox = container?.querySelector<HTMLButtonElement>('[role="checkbox"]')
    expect(checkbox?.getAttribute('aria-checked')).toBe('false')
    act(() => checkbox?.click())

    expect(onToggleSelectAll).toHaveBeenCalledWith(true)
  })
})
