// @vitest-environment happy-dom

import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import type { ReactNode } from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { DetectedWorktree, DetectedWorktreeListResult, Repo } from '../../../../shared/types'

const SCRATCH_PATH = '/repo/.claude/worktrees/scratch-1'

const mocks = vi.hoisted(() => ({
  state: {
    activeModal: 'worktree-visibility' as string | null,
    modalData: { repoId: 'repo-1' } as Record<string, unknown>,
    closeModal: vi.fn(),
    repos: [] as unknown[],
    updateRepo: vi.fn(),
    fetchWorktrees: vi.fn(),
    detectedWorktreesByRepo: {} as Record<string, unknown>
  }
}))

vi.mock('@/store', () => ({
  useAppStore: Object.assign(
    (selector: (state: typeof mocks.state) => unknown) => selector(mocks.state),
    { getState: () => mocks.state }
  )
}))

vi.mock('@/components/ui/dialog', () => ({
  Dialog: ({ open, children }: { open: boolean; children: ReactNode }) =>
    open ? <div>{children}</div> : null,
  DialogContent: ({ children }: { children: ReactNode }) => <div>{children}</div>,
  DialogDescription: ({ children }: { children: ReactNode }) => <div>{children}</div>,
  DialogHeader: ({ children }: { children: ReactNode }) => <div>{children}</div>,
  DialogTitle: ({ children }: { children: ReactNode }) => <div>{children}</div>
}))

vi.mock('@/i18n/i18n', () => ({
  translate: (_key: string, fallback: string, values?: Record<string, unknown>) =>
    values
      ? fallback.replace(/\{\{(\w+)\}\}/g, (_match, name: string) => String(values[name] ?? ''))
      : fallback
}))

function makeRepo(overrides: Partial<Repo> = {}): Repo {
  return {
    id: 'repo-1',
    path: '/repo',
    displayName: 'orca',
    badgeColor: '#000000',
    addedAt: Date.UTC(2026, 4, 24),
    externalWorktreeVisibility: 'hide',
    externalWorktreeVisibilityPromptDismissedAt: 1,
    // Why: the inbox already stopped announcing this path; recovery must not depend on it.
    externalWorktreeInboxBaselinePaths: [SCRATCH_PATH],
    ...overrides
  }
}

function makeWorktree(overrides: Partial<DetectedWorktree> = {}): DetectedWorktree {
  return {
    id: `repo-1::${overrides.path ?? SCRATCH_PATH}`,
    repoId: 'repo-1',
    path: SCRATCH_PATH,
    displayName: 'scratch-1',
    branch: 'refs/heads/scratch-1',
    head: 'abc123',
    isBare: false,
    isMainWorktree: false,
    comment: '',
    linkedIssue: null,
    linkedPR: null,
    linkedLinearIssue: null,
    isArchived: false,
    isUnread: false,
    isPinned: false,
    sortOrder: 0,
    lastActivityAt: 0,
    ownership: 'agent-scratch',
    selectedCheckout: false,
    visible: false,
    ...overrides
  } as DetectedWorktree
}

function makeDetected(
  worktrees: DetectedWorktree[] = [makeWorktree()],
  overrides: Partial<DetectedWorktreeListResult> = {}
): DetectedWorktreeListResult {
  return {
    repoId: 'repo-1',
    authoritative: true,
    source: 'git',
    worktrees,
    ...overrides
  }
}

let container: HTMLDivElement
let root: Root

beforeEach(() => {
  vi.clearAllMocks()
  mocks.state.activeModal = 'worktree-visibility'
  mocks.state.modalData = { repoId: 'repo-1' }
  mocks.state.repos = [makeRepo()]
  mocks.state.detectedWorktreesByRepo = { 'repo-1': makeDetected() }
  mocks.state.updateRepo.mockResolvedValue(true)
  mocks.state.fetchWorktrees.mockResolvedValue(true)
  container = document.createElement('div')
  document.body.appendChild(container)
  root = createRoot(container)
})

afterEach(() => {
  act(() => {
    root.unmount()
  })
  container.remove()
  document.body.innerHTML = ''
})

async function renderDialog(): Promise<void> {
  const { default: WorktreeVisibilityDialog } = await import('./WorktreeVisibilityDialog')
  await act(async () => {
    root.render(<WorktreeVisibilityDialog />)
  })
}

function buttonWithText(text: string): HTMLButtonElement {
  const button = [...document.querySelectorAll('button')].find(
    (candidate) => (candidate.textContent ?? '').trim() === text
  )
  if (!button) {
    throw new Error(`No button with text "${text}"`)
  }
  return button as HTMLButtonElement
}

async function click(element: HTMLElement): Promise<void> {
  await act(async () => {
    element.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }))
  })
}

describe('WorktreeVisibilityDialog', () => {
  it('lists a hidden agent worktree the toggle cannot reveal, with a repo-relative path', async () => {
    await renderDialog()

    expect(document.body.textContent).toContain('Hidden worktrees')
    expect(document.body.textContent).toContain('scratch-1')
    expect(document.body.textContent).toContain('.claude/worktrees/scratch-1')
    expect(document.body.textContent).not.toContain('/repo/.claude')
  })

  it('recovers a hidden worktree per path through the existing import exception', async () => {
    // Why: reproduces #10324 — the path is baselined (inbox silent) and the toggle
    // never reveals scratch, so this row's Show is the only way back.
    await renderDialog()

    await click(buttonWithText('Show'))

    expect(mocks.state.updateRepo).toHaveBeenCalledWith('repo-1', {
      importedExternalWorktreePaths: [SCRATCH_PATH],
      externalWorktreeInboxBaselinePaths: [SCRATCH_PATH]
    })
    expect(mocks.state.fetchWorktrees).toHaveBeenCalledWith('repo-1', {
      requireAuthoritative: true
    })
    expect(mocks.state.closeModal).not.toHaveBeenCalled()
  })

  it('omits the hidden list when nothing is recoverable', async () => {
    mocks.state.detectedWorktreesByRepo = { 'repo-1': makeDetected([]) }
    await renderDialog()

    expect(document.body.textContent).not.toContain('Hidden worktrees')
  })

  it('says it is checking instead of claiming nothing is hidden on a fallback snapshot', async () => {
    mocks.state.detectedWorktreesByRepo = {
      'repo-1': makeDetected([makeWorktree()], { authoritative: false, source: 'session-fallback' })
    }
    mocks.state.fetchWorktrees.mockImplementation(() => new Promise(() => {}))
    await renderDialog()

    expect(document.body.textContent).toContain('Checking…')
    expect(document.body.textContent).not.toContain('Hidden worktrees')
    expect(mocks.state.fetchWorktrees).toHaveBeenCalledWith('repo-1', {
      requireAuthoritative: true
    })
  })

  it('offers a retry instead of a dead end when the list cannot be read', async () => {
    mocks.state.detectedWorktreesByRepo = {
      'repo-1': makeDetected([makeWorktree()], { authoritative: false, source: 'session-fallback' })
    }
    mocks.state.fetchWorktrees.mockResolvedValue(false)
    await renderDialog()

    expect(document.querySelector('[role="alert"]')?.textContent).toContain(
      "Could not list this repo's worktrees."
    )

    // Why: a successful authoritative refetch also writes the trusted snapshot.
    mocks.state.fetchWorktrees.mockImplementation(async () => {
      mocks.state.detectedWorktreesByRepo = { 'repo-1': makeDetected() }
      return true
    })
    await click(buttonWithText('Try again'))

    expect(document.querySelector('[role="alert"]')).toBeNull()
    expect(document.body.textContent).toContain('Hidden worktrees')
  })

  it('keeps rows visible but not actionable until the open-time scan settles', async () => {
    // Why: a Show clicked mid-scan could join the pre-write refetch and read
    // success off a list computed before the import landed — a silent no-op.
    mocks.state.fetchWorktrees.mockImplementation(() => new Promise(() => {}))
    await renderDialog()

    expect(document.body.textContent).toContain('scratch-1')
    expect(buttonWithText('Show').disabled).toBe(true)
    expect(document.body.textContent).toContain('Checking…')
  })

  it('reports a failed refresh even while an older trusted snapshot is on screen', async () => {
    // Why: a warm snapshot must not present stale rows as current with no
    // failure indication when the host has since become unreachable.
    mocks.state.fetchWorktrees.mockResolvedValue(false)
    await renderDialog()

    expect(document.body.textContent).toContain('scratch-1')
    expect(document.querySelector('[role="alert"]')?.textContent).toContain(
      "Could not list this repo's worktrees."
    )
  })

  it('keeps the repo-wide toggle unchanged, never counting scratch toward it', async () => {
    await renderDialog()

    expect(document.body.textContent).toContain('0 worktrees available to import')

    await click(buttonWithText('Import'))

    expect(mocks.state.updateRepo).toHaveBeenCalledWith('repo-1', {
      externalWorktreeVisibility: 'show',
      externalWorktreeDiscoverySuppressedAt: null
    })
  })
})
