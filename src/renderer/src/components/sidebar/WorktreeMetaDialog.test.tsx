// @vitest-environment happy-dom

import { act, type ReactNode } from 'react'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { useAppStore } from '@/store'
import type { FolderWorkspace, Repo, Worktree, WorktreeMeta } from '../../../../shared/types'
import { folderWorkspaceKey } from '../../../../shared/workspace-scope'

// Why: Radix tooltips need a provider the dialog does not own, and the menu's
// portal needs real layout. Stand-ins keep these tests on provider selection.
vi.mock('@/components/ui/tooltip', () => ({
  Tooltip: ({ children }: { children?: ReactNode }) => <>{children}</>,
  TooltipContent: () => null,
  TooltipTrigger: ({ children }: { children?: ReactNode }) => <>{children}</>
}))

vi.mock('@/components/ui/dropdown-menu', async () => {
  const React = await import('react')
  const SelectContext = React.createContext<(value: string) => void>(() => {})
  const Passthrough = ({ children }: { children?: ReactNode }) => <>{children}</>
  return {
    DropdownMenu: Passthrough,
    DropdownMenuTrigger: Passthrough,
    DropdownMenuContent: Passthrough,
    DropdownMenuRadioGroup: ({
      value,
      onValueChange,
      children
    }: {
      value: string
      onValueChange: (value: string) => void
      children?: ReactNode
    }) => (
      <SelectContext.Provider value={onValueChange}>
        <div data-selected={value}>{children}</div>
      </SelectContext.Provider>
    ),
    DropdownMenuRadioItem: ({ value, children }: { value: string; children?: ReactNode }) => {
      const onSelect = React.useContext(SelectContext)
      return (
        <button type="button" role="menuitemradio" onClick={() => onSelect(value)}>
          {children}
        </button>
      )
    }
  }
})

import WorktreeMetaDialog from './WorktreeMetaDialog'

const REPO_ID = 'repo-1'
const WORKTREE_ID = 'repo-1::/repo/worktrees/feature'

const initialState = useAppStore.getInitialState()
const updateWorktreeMeta =
  vi.fn<
    (
      id: string,
      updates: Partial<WorktreeMeta>
    ) => Promise<{ ok: true } | { ok: false; error: string }>
  >()

function makeRepo(): Repo {
  return { id: REPO_ID, path: '/repo', displayName: 'orca', badgeColor: '#999999', addedAt: 1 }
}

function makeWorktree(overrides: Partial<Worktree> = {}): Worktree {
  return {
    id: WORKTREE_ID,
    repoId: REPO_ID,
    path: '/repo/worktrees/feature',
    displayName: 'Feature work',
    branch: 'feature',
    head: 'abc123',
    isBare: false,
    isMainWorktree: false,
    comment: 'existing note',
    linkedIssue: null,
    linkedPR: null,
    linkedLinearIssue: null,
    isArchived: false,
    isUnread: false,
    isPinned: false,
    sortOrder: 0,
    lastActivityAt: 1,
    ...overrides
  }
}

function makeFolderWorkspace(overrides: Partial<FolderWorkspace> = {}): FolderWorkspace {
  return {
    id: 'fw-1',
    projectGroupId: 'pg-1',
    name: 'Docs folder',
    folderPath: '/repo/docs',
    linkedTask: {
      provider: 'linear',
      type: 'issue',
      number: 901,
      title: 'Fix auth',
      url: 'https://linear.app/acme/issue/STA-901',
      linearIdentifier: 'STA-901'
    },
    comment: '',
    isArchived: false,
    isUnread: false,
    isPinned: false,
    sortOrder: 0,
    lastActivityAt: 1,
    createdAt: 1,
    updatedAt: 1,
    ...overrides
  }
}

function openDialog(
  options: {
    worktree?: Partial<Worktree>
    worktreeId?: string
    folderWorkspace?: Partial<FolderWorkspace>
  } = {}
): void {
  const worktree = makeWorktree(options.worktree)
  useAppStore.setState({
    repos: [makeRepo()],
    worktreesByRepo: { [REPO_ID]: [worktree] },
    ...(options.folderWorkspace
      ? { folderWorkspaces: [makeFolderWorkspace(options.folderWorkspace)] }
      : {}),
    activeModal: 'edit-meta',
    modalData: {
      worktreeId: options.worktreeId ?? worktree.id,
      currentDisplayName: worktree.displayName,
      currentComment: worktree.comment,
      focus: 'comment'
    },
    updateWorktreeMeta
  })
  render(<WorktreeMetaDialog />)
}

function issueInput(): HTMLInputElement {
  return screen.getByPlaceholderText('Issue #, or a GitHub or Linear URL')
}

function providerChip(): HTMLButtonElement {
  return screen.getByRole('button', { name: 'Issue provider' })
}

function saveButton(): HTMLButtonElement {
  return screen.getByRole('button', { name: 'Save' })
}

describe('WorktreeMetaDialog issue link row', () => {
  beforeEach(() => {
    useAppStore.setState(initialState, true)
    updateWorktreeMeta.mockReset()
    updateWorktreeMeta.mockResolvedValue({ ok: true })
    Object.defineProperty(window, 'api', {
      configurable: true,
      value: { shell: { openUrl: vi.fn() } }
    })
  })

  afterEach(() => {
    cleanup()
    useAppStore.setState(initialState, true)
  })

  it('seeds the chip and value from a GitHub link', () => {
    openDialog({ worktree: { linkedIssue: 42 } })

    expect(providerChip().textContent).toContain('GitHub')
    expect(issueInput().value).toBe('42')
  })

  it('seeds the chip and value from a Linear link', () => {
    openDialog({ worktree: { linkedLinearIssue: 'STA-335' } })

    expect(providerChip().textContent).toContain('Linear')
    expect(issueInput().value).toBe('STA-335')
  })

  it('flips to Linear when a linear.app issue URL is pasted', () => {
    openDialog({ worktree: { linkedIssue: 42 } })

    fireEvent.change(issueInput(), {
      target: { value: 'https://linear.app/acme/issue/STA-335/fix-the-thing' }
    })

    expect(providerChip().textContent).toContain('Linear')
  })

  // Why: Linear and Jira issue keys are the same shape, so only a URL may steer
  // the provider — a bare key must never override the user's explicit choice.
  it('keeps the chip on GitHub when a bare issue key is typed', () => {
    openDialog({ worktree: { linkedIssue: 42 } })

    fireEvent.change(issueInput(), { target: { value: 'GH-1234' } })

    expect(providerChip().textContent).toContain('GitHub')
    expect(providerChip().textContent).not.toContain('Linear')
  })

  it('flips to GitHub when a GitHub issue URL is pasted over a Linear link', () => {
    openDialog({ worktree: { linkedLinearIssue: 'STA-335' } })

    fireEvent.change(issueInput(), {
      target: { value: 'https://github.com/acme/orca/issues/77' }
    })

    expect(providerChip().textContent).toContain('GitHub')
  })

  it('names the Linear issue that switching to GitHub would unlink', () => {
    openDialog({ worktree: { linkedLinearIssue: 'STA-335' } })

    fireEvent.click(screen.getByRole('menuitemradio', { name: 'GitHub' }))
    fireEvent.change(issueInput(), { target: { value: '99' } })

    expect(
      screen.getByText('Saving unlinks Linear STA-335 — a workspace tracks one issue.')
    ).toBeTruthy()
  })

  // Both slots can hold a link at once — naming only one understates the save.
  it('names both links when clearing the field would drop both', () => {
    openDialog({ worktree: { linkedIssue: 42, linkedLinearIssue: 'STA-335' } })

    fireEvent.change(issueInput(), { target: { value: '' } })

    expect(
      screen.getByText(
        'Saving unlinks Linear STA-335 and GitHub #42 — a workspace tracks one issue.'
      )
    ).toBeTruthy()
  })

  // A failed save refetches and reverts the optimistic write, so closing here
  // would report success for an edit that silently undid itself.
  it('keeps the dialog open and reports why when the save fails', async () => {
    openDialog({ worktree: { linkedLinearIssue: 'STA-335' } })
    updateWorktreeMeta.mockResolvedValue({ ok: false, error: 'Runtime is offline' })

    fireEvent.change(issueInput(), { target: { value: 'STA-999' } })
    await act(async () => {
      fireEvent.click(saveButton())
    })

    expect(screen.getByRole('alert').textContent).toBe('Runtime is offline')
    expect(useAppStore.getState().activeModal).toBe('edit-meta')
  })

  it('leaves the Linear link alone when only the comment is edited', async () => {
    openDialog({ worktree: { linkedLinearIssue: 'STA-335' } })

    fireEvent.change(screen.getByPlaceholderText('Notes about this worktree...'), {
      target: { value: 'updated note' }
    })

    expect(screen.queryByText(/Saving unlinks/)).toBeNull()

    await act(async () => {
      fireEvent.click(saveButton())
    })

    await waitFor(() => expect(updateWorktreeMeta).toHaveBeenCalledTimes(1))
    const updates = updateWorktreeMeta.mock.calls[0]?.[1] ?? {}
    expect(Object.keys(updates)).not.toContain('linkedLinearIssue')
    expect(Object.keys(updates)).not.toContain('linkedIssue')
    expect(updates.comment).toBe('updated note')
  })

  it('blocks saving an unparseable Linear value', () => {
    openDialog({ worktree: { linkedLinearIssue: 'STA-335' } })

    fireEvent.change(issueInput(), { target: { value: 'not an issue' } })

    expect(screen.getByText('Not a Linear issue key or linear.app issue URL.')).toBeTruthy()
    expect(saveButton().disabled).toBe(true)
  })

  it('is read-only for a folder workspace', () => {
    openDialog({ worktreeId: folderWorkspaceKey('fw-1') })

    expect(issueInput().disabled).toBe(true)
    expect(providerChip().disabled).toBe(true)
    expect(
      screen.getByText(
        "Issue links are set when a folder workspace is created and can't be changed here yet."
      )
    ).toBeTruthy()
  })

  // Folder workspaces live outside worktreesByRepo, so the indexed lookup alone
  // leaves the row blank and the link it does hold looks lost.
  it('shows a folder workspace its own linked issue', () => {
    openDialog({ worktreeId: folderWorkspaceKey('fw-1'), folderWorkspace: {} })

    expect(issueInput().value).toBe('STA-901')
    expect(providerChip().textContent).toContain('Linear')
  })

  // A background `orca worktree set` must not move the baseline mid-edit: the
  // field would read as dirty and a comment-only save would write the stale seed.
  it('keeps the baseline frozen when the store changes while open', async () => {
    openDialog({ worktree: { linkedLinearIssue: 'STA-335' } })

    act(() => {
      useAppStore.setState({
        worktreesByRepo: {
          [REPO_ID]: [makeWorktree({ linkedLinearIssue: 'STA-999' })]
        }
      })
    })
    fireEvent.change(screen.getByPlaceholderText('Notes about this worktree...'), {
      target: { value: 'still working' }
    })
    await act(async () => {
      fireEvent.click(saveButton())
    })

    const updates = updateWorktreeMeta.mock.calls[0]?.[1] ?? {}
    expect(updates.comment).toBe('still working')
    expect(updates).not.toHaveProperty('linkedLinearIssue')
    expect(updates).not.toHaveProperty('linkedIssue')
  })

  it('dispatches nothing when the dialog is cancelled', async () => {
    openDialog({ worktree: { linkedLinearIssue: 'STA-335' } })

    fireEvent.change(issueInput(), { target: { value: '99' } })
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Cancel' }))
    })

    expect(updateWorktreeMeta).not.toHaveBeenCalled()
    expect(useAppStore.getState().activeModal).toBe('none')
  })
})
