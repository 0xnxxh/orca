// @vitest-environment happy-dom

// Repro for #6235: two projects whose displayName collides render as identical
// rows in both sidebar repository filter surfaces, with nothing (path, host)
// to tell them apart.

import { act, type ReactNode } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { AppState } from '@/store'
import type { Repo } from '../../../../shared/types'

const duplicateRepos = [
  {
    id: 'repo-alpha',
    path: '/Users/dev/work/alpha/project',
    displayName: 'project',
    badgeColor: '#ff0000',
    addedAt: 1
  },
  {
    id: 'repo-beta',
    path: '/Users/dev/work/beta/project',
    displayName: 'project',
    badgeColor: '#00ff00',
    addedAt: 2
  }
] as Repo[]

const mocks = vi.hoisted(() => ({
  state: {} as Partial<AppState>
}))

vi.mock('@/store', () => ({
  useAppStore: (selector: (state: Partial<AppState>) => unknown) => selector(mocks.state)
}))

// Radix portals/tooltips don't render deterministically in happy-dom; the rows
// under test are plain children, so pass them straight through.
vi.mock('@/components/ui/dropdown-menu', () => ({
  DropdownMenu: ({ children }: { children: ReactNode }) => <>{children}</>,
  DropdownMenuContent: ({ children }: { children: ReactNode }) => <div>{children}</div>,
  DropdownMenuTrigger: ({ children }: { children: ReactNode }) => <>{children}</>,
  DropdownMenuSeparator: () => <hr />,
  DropdownMenuShortcut: ({ children }: { children: ReactNode }) => <span>{children}</span>
}))

vi.mock('@/components/ui/tooltip', () => ({
  Tooltip: ({ children }: { children: ReactNode }) => <>{children}</>,
  TooltipTrigger: ({ children }: { children: ReactNode }) => <>{children}</>,
  TooltipContent: () => null
}))

vi.mock('@/hooks/useShortcutLabel', () => ({
  useShortcutLabel: () => 'Unassigned'
}))

const roots: Root[] = []

globalThis.IS_REACT_ACT_ENVIRONMENT = true

async function render(node: ReactNode): Promise<HTMLDivElement> {
  const container = document.createElement('div')
  document.body.appendChild(container)
  const root = createRoot(container)
  roots.push(root)
  await act(async () => {
    root.render(node)
  })
  return container
}

function readProjectRowTexts(container: HTMLElement): string[] {
  return [...container.querySelectorAll('[data-value^="repo-"]')].map((row) =>
    (row.textContent ?? '').replaceAll(/\s+/gu, ' ').trim()
  )
}

afterEach(() => {
  for (const root of roots.splice(0)) {
    act(() => root.unmount())
  }
  document.body.innerHTML = ''
  mocks.state = {}
})

describe('#6235 duplicate project names in the sidebar repository filters', () => {
  it('distinguishes same-named projects in the sidebar filter menu', async () => {
    mocks.state = {
      repos: duplicateRepos,
      filterRepoIds: [],
      setFilterRepoIds: vi.fn(),
      addRepo: vi.fn(),
      showSleepingWorkspaces: false,
      setShowSleepingWorkspaces: vi.fn(),
      hideDefaultBranchWorkspace: false,
      setHideDefaultBranchWorkspace: vi.fn(),
      hideAutomationGeneratedWorkspaces: false,
      setHideAutomationGeneratedWorkspaces: vi.fn(),
      hideCliCreatedWorkspaces: false,
      setHideCliCreatedWorkspaces: vi.fn(),
      hideDetachedHeadWorkspaces: false,
      setHideDetachedHeadWorkspaces: vi.fn()
    } as Partial<AppState>

    const { default: SidebarFilter } = await import('./SidebarFilter')
    const container = await render(<SidebarFilter />)
    const rowTexts = readProjectRowTexts(container)

    expect(rowTexts).toHaveLength(2)
    expect(rowTexts[1]).not.toBe(rowTexts[0])
    expect(rowTexts.join(' | ')).toContain('alpha')
  })

  it('distinguishes same-named projects in the repository filter section', async () => {
    mocks.state = {
      repos: duplicateRepos,
      filterRepoIds: [],
      setFilterRepoIds: vi.fn()
    } as Partial<AppState>

    const { default: SidebarRepositoryFilterSection } = await import(
      './SidebarRepositoryFilterSection'
    )
    const container = await render(<SidebarRepositoryFilterSection />)
    const rowTexts = readProjectRowTexts(container)

    expect(rowTexts).toHaveLength(2)
    expect(rowTexts[1]).not.toBe(rowTexts[0])
    expect(rowTexts.join(' | ')).toContain('alpha')
  })
})
