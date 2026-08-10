// @vitest-environment happy-dom
import type { ReactNode } from 'react'
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { WORKSPACE_CLEANUP_BUILT_IN_PRESETS } from '../../../../shared/workspace-cleanup-presets'
import { WorkspaceCleanupPresetChips } from './workspace-cleanup-preset-chips'

vi.mock('@/components/ui/tooltip', () => ({
  Tooltip: ({ children }: { children: ReactNode }) => <>{children}</>,
  TooltipContent: () => null,
  TooltipTrigger: ({ children }: { children: ReactNode }) => <>{children}</>
}))

let root: Root | null = null
let container: HTMLDivElement | null = null

function render(node: ReactNode): void {
  act(() => root?.render(node))
}

function chip(presetId: string): HTMLButtonElement | null {
  return container?.querySelector<HTMLButtonElement>(`[data-preset-id="${presetId}"]`) ?? null
}

describe('WorkspaceCleanupPresetChips', () => {
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

  it('renders every preset as a chip instead of a fixed tab set', () => {
    render(
      <WorkspaceCleanupPresetChips
        presets={WORKSPACE_CLEANUP_BUILT_IN_PRESETS}
        matchedPresetId="suggested"
        requestedPresetId="suggested"
        hasActiveFilters={false}
        onApplyPreset={vi.fn()}
        onClearFilters={vi.fn()}
      />
    )

    expect(container?.querySelectorAll('[data-preset-id]')).toHaveLength(
      WORKSPACE_CLEANUP_BUILT_IN_PRESETS.length
    )
    expect(chip('ignored')).not.toBeNull()
    expect(chip('all')).not.toBeNull()
  })

  it('marks the matched preset active and the edited one modified', () => {
    render(
      <WorkspaceCleanupPresetChips
        presets={WORKSPACE_CLEANUP_BUILT_IN_PRESETS}
        matchedPresetId={null}
        requestedPresetId="needs-review"
        hasActiveFilters
        onApplyPreset={vi.fn()}
        onClearFilters={vi.fn()}
      />
    )

    expect(chip('needs-review')?.getAttribute('data-preset-state')).toBe('modified')
    expect(chip('needs-review')?.getAttribute('aria-pressed')).toBe('false')
    expect(chip('suggested')?.getAttribute('data-preset-state')).toBe('idle')
  })

  it('applies the clicked preset', () => {
    const onApplyPreset = vi.fn()
    render(
      <WorkspaceCleanupPresetChips
        presets={WORKSPACE_CLEANUP_BUILT_IN_PRESETS}
        matchedPresetId="suggested"
        requestedPresetId="suggested"
        hasActiveFilters={false}
        onApplyPreset={onApplyPreset}
        onClearFilters={vi.fn()}
      />
    )

    act(() => chip('largest')?.click())

    expect(onApplyPreset).toHaveBeenCalledWith(
      WORKSPACE_CLEANUP_BUILT_IN_PRESETS.find((preset) => preset.id === 'largest')
    )
  })

  it('only offers clear filters once something is filtered', () => {
    const onClearFilters = vi.fn()
    render(
      <WorkspaceCleanupPresetChips
        presets={WORKSPACE_CLEANUP_BUILT_IN_PRESETS}
        matchedPresetId={null}
        requestedPresetId={null}
        hasActiveFilters={false}
        onApplyPreset={vi.fn()}
        onClearFilters={onClearFilters}
      />
    )
    expect(container?.textContent).not.toContain('Clear filters')

    render(
      <WorkspaceCleanupPresetChips
        presets={WORKSPACE_CLEANUP_BUILT_IN_PRESETS}
        matchedPresetId={null}
        requestedPresetId={null}
        hasActiveFilters
        onApplyPreset={vi.fn()}
        onClearFilters={onClearFilters}
      />
    )
    const clearButton = [...(container?.querySelectorAll('button') ?? [])].find((button) =>
      button.textContent?.includes('Clear filters')
    )
    act(() => clearButton?.click())
    expect(onClearFilters).toHaveBeenCalledTimes(1)
  })
})
