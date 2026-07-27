// @vitest-environment happy-dom

import { act, useState, type ReactNode } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type {
  SkillFreshnessInstallation,
  SkillFreshnessInventory,
  SkillUpdateRun
} from '../../../../shared/skill-freshness'
import { SkillFreshnessUpdateDialog } from './SkillFreshnessUpdateDialog'
import {
  consumeSkillFreshnessUpdateDialogRequest,
  requestSkillFreshnessUpdateDialog
} from './skill-freshness-update-dialog'
import { _resetSkillUpdateRunStore } from './skill-update-run-store'

const mocks = vi.hoisted(() => ({
  inventory: null as SkillFreshnessInventory | null,
  loading: false,
  error: null as string | null,
  refresh: vi.fn(),
  notifyChanged: vi.fn()
}))

vi.mock('@/hooks/useSkillFreshness', () => ({
  useSkillFreshness: () => ({
    inventory: mocks.inventory,
    loading: mocks.loading,
    error: mocks.error,
    refresh: mocks.refresh
  })
}))

vi.mock('@/hooks/useInstalledAgentSkills', () => ({
  notifyInstalledAgentSkillsChanged: mocks.notifyChanged
}))

// Radix Dialog/Collapsible internals (portal, focus-scope) are exercised in
// Electron QA; here the content logic is what matters, so use plain wrappers.
vi.mock('@/components/ui/dialog', () => ({
  Dialog: ({ open, children }: { open: boolean; children?: ReactNode }) =>
    open ? <div data-dialog-open="true">{children}</div> : null,
  DialogContent: ({ children }: { children?: ReactNode }) => <div>{children}</div>,
  DialogDescription: ({ children }: { children?: ReactNode }) => <p>{children}</p>,
  DialogFooter: ({ children }: { children?: ReactNode }) => <div>{children}</div>,
  DialogHeader: ({ children }: { children?: ReactNode }) => <div>{children}</div>,
  DialogTitle: ({ children }: { children?: ReactNode }) => <h2>{children}</h2>
}))

vi.mock('@/components/ui/collapsible', () => ({
  Collapsible: ({
    children,
    defaultOpen = false
  }: {
    children?: ReactNode
    defaultOpen?: boolean
  }) => {
    const [open] = useState(defaultOpen)
    return <div data-collapsible-open={String(open)}>{children}</div>
  },
  CollapsibleTrigger: ({ children }: { children?: ReactNode }) => <div>{children}</div>,
  CollapsibleContent: ({ children }: { children?: ReactNode }) => <div>{children}</div>
}))

const skillsApi = {
  startUpdateRun: vi.fn(async () => ({ started: true as const })),
  cancelUpdateRun: vi.fn(async () => {}),
  acknowledgeUpdateRun: vi.fn(async () => {}),
  getUpdateRun: vi.fn(async (): Promise<SkillUpdateRun> => ({ state: 'idle' })),
  onUpdateRun: vi.fn((callback: (run: SkillUpdateRun) => void) => {
    pushRun = callback
    return () => {}
  })
}
let pushRun: ((run: SkillUpdateRun) => void) | null = null

function placement(
  name: string,
  overrides: Partial<SkillFreshnessInstallation> = {}
): SkillFreshnessInstallation {
  return {
    id: `${name}-${overrides.rootId ?? 'home-agents'}`,
    name,
    rootId: 'home-agents',
    providers: ['agent-skills'],
    sourceKind: 'home',
    sourceLabel: 'Agent skills home',
    unresolvedPath: `/home/.agents/skills/${name}`,
    resolvedPath: `/home/.agents/skills/${name}`,
    physicalIdentity: `physical-${name}`,
    topology: 'canonical-copy',
    status: 'outdated',
    installedReleaseRevision: 1,
    installedAppVersion: '1.0.0',
    currentReleaseRevision: 2,
    currentPackageDigest: 'current',
    currentAppVersion: '2.0.0',
    observedPackageDigest: 'old',
    errorCategory: null,
    ...overrides
  }
}

function eligibleInventory(): SkillFreshnessInventory {
  return {
    schemaVersion: 1,
    installations: [placement('orca-cli')],
    eligibleUpdateNames: ['orca-cli'],
    scannedAt: 1
  }
}

let root: Root | null = null
let container: HTMLDivElement | null = null

async function renderDialog(): Promise<void> {
  container = document.createElement('div')
  document.body.appendChild(container)
  root = createRoot(container)
  await act(async () => {
    root?.render(<SkillFreshnessUpdateDialog />)
  })
}

async function rerender(): Promise<void> {
  await act(async () => {
    root?.render(<SkillFreshnessUpdateDialog />)
  })
}

async function openViaRequest(): Promise<void> {
  await act(async () => {
    requestSkillFreshnessUpdateDialog()
  })
}

function findButton(label: string): HTMLButtonElement | undefined {
  return Array.from(container?.querySelectorAll('button') ?? []).find(
    (candidate) => candidate.textContent?.trim() === label
  )
}

async function clickButton(label: string): Promise<void> {
  const button = findButton(label)
  expect(button, `expected a "${label}" button`).toBeDefined()
  await act(async () => {
    button?.dispatchEvent(new MouseEvent('click', { bubbles: true }))
  })
}

async function emitRun(run: SkillUpdateRun): Promise<void> {
  await act(async () => {
    pushRun?.(run)
  })
}

describe('SkillFreshnessUpdateDialog', () => {
  beforeEach(() => {
    consumeSkillFreshnessUpdateDialogRequest()
    _resetSkillUpdateRunStore()
    pushRun = null
    mocks.inventory = eligibleInventory()
    mocks.loading = false
    mocks.error = null
    mocks.refresh.mockReset()
    mocks.notifyChanged.mockReset()
    skillsApi.startUpdateRun.mockClear()
    skillsApi.cancelUpdateRun.mockClear()
    skillsApi.acknowledgeUpdateRun.mockClear()
    skillsApi.getUpdateRun.mockClear()
    ;(window as unknown as { api: { skills: typeof skillsApi } }).api = { skills: skillsApi }
  })

  afterEach(async () => {
    if (root) {
      await act(async () => root?.unmount())
    }
    root = null
    container?.remove()
    container = null
  })

  it('stays closed until an open request arrives', async () => {
    await renderDialog()
    expect(container?.querySelector('[data-dialog-open]')).toBeNull()
  })

  it('offers a primary update action and never renders a terminal', async () => {
    await renderDialog()
    await openViaRequest()

    expect(container?.textContent).toContain('Update skills')
    expect(container?.textContent).toContain('1 update available')
    expect(findButton('Update 1 skill')).toBeDefined()
    expect(container?.querySelector('[data-testid="update-terminal"]')).toBeNull()
    expect(container?.textContent).not.toContain('press Enter')
  })

  it('starts a background run with the eligible names', async () => {
    await renderDialog()
    await openViaRequest()
    await clickButton('Update 1 skill')

    expect(skillsApi.startUpdateRun).toHaveBeenCalledWith(['orca-cli'])
  })

  it('shows indeterminate progress and says the run survives closing', async () => {
    await renderDialog()
    await openViaRequest()
    await emitRun({ state: 'running', names: ['orca-cli'], startedAt: 1, output: '' })

    expect(container?.textContent).toContain('Updating 1 skill…')
    expect(container?.textContent).toContain('keeps running in the background')
    expect(container?.querySelector('[role="progressbar"]')).not.toBeNull()
    expect(
      container?.querySelector('[data-skill-result="orca-cli"]')?.getAttribute('data-status')
    ).toBe('pending')
  })

  it('does not cancel the run when the dialog is closed', async () => {
    await renderDialog()
    await openViaRequest()
    await emitRun({ state: 'running', names: ['orca-cli'], startedAt: 1, output: '' })
    await clickButton('Close')

    expect(container?.querySelector('[data-dialog-open]')).toBeNull()
    expect(skillsApi.cancelUpdateRun).not.toHaveBeenCalled()
  })

  it('reports per-skill success once the run settles', async () => {
    await renderDialog()
    await openViaRequest()
    await emitRun({
      state: 'success',
      names: ['orca-cli'],
      finishedAt: 2,
      output: '✓ Updated 1 skill(s)'
    })

    expect(container?.textContent).toContain('Updated 1 skill')
    expect(
      container?.querySelector('[data-skill-result="orca-cli"]')?.getAttribute('data-status')
    ).toBe('done')
    expect(findButton('Done')).toBeDefined()
    // The re-scan is what makes the result trustworthy, so it must be requested.
    expect(mocks.notifyChanged).toHaveBeenCalled()
  })

  it('attributes failures to the names the re-scan says are still outdated', async () => {
    mocks.inventory = {
      schemaVersion: 1,
      installations: [placement('orca-cli'), placement('orchestration')],
      eligibleUpdateNames: ['orca-cli', 'orchestration'],
      scannedAt: 1
    }
    await renderDialog()
    await openViaRequest()
    await emitRun({
      state: 'error',
      names: ['orca-cli', 'orchestration'],
      failedNames: ['orchestration'],
      finishedAt: 3,
      output: '✗ Failed to update orchestration',
      message: 'skills update exited with code 1'
    })

    expect(container?.textContent).toContain('Updated 1 of 2 skills')
    expect(
      container?.querySelector('[data-skill-result="orca-cli"]')?.getAttribute('data-status')
    ).toBe('done')
    expect(
      container?.querySelector('[data-skill-result="orchestration"]')?.getAttribute('data-status')
    ).toBe('failed')
    expect(container?.textContent).toContain('skills update exited with code 1')
    expect(findButton('Retry')).toBeDefined()
  })

  it('shows the captured log verbatim without parsing it', async () => {
    await renderDialog()
    await openViaRequest()
    await emitRun({
      state: 'success',
      names: ['orca-cli'],
      finishedAt: 2,
      output: 'Checking skills from source: stablyai/orca\n  ✓ Updated orca-cli'
    })

    expect(container?.querySelector('pre')?.textContent).toContain(
      'Checking skills from source: stablyai/orca'
    )
  })

  it('shows the up-to-date state once every installation is current', async () => {
    mocks.inventory = {
      schemaVersion: 1,
      installations: [placement('orca-cli', { status: 'current', installedReleaseRevision: 2 })],
      eligibleUpdateNames: [],
      scannedAt: 2
    }
    await renderDialog()
    await openViaRequest()

    expect(container?.textContent).toContain('All installed Orca skills are up to date.')
    expect(findButton('Update 1 skill')).toBeUndefined()
  })

  it('keeps skills it cannot update visible with their reason', async () => {
    mocks.inventory = {
      schemaVersion: 1,
      installations: [placement('computer-use', { topology: 'repo-scope' })],
      eligibleUpdateNames: [],
      scannedAt: 3
    }
    await renderDialog()
    await openViaRequest()

    expect(container?.textContent).toContain('computer-use')
    expect(container?.textContent).toContain('Skipped')
  })

  it('surfaces a scan error instead of a stale summary', async () => {
    mocks.inventory = null
    mocks.error = 'Missing canonical agent skills root'
    await renderDialog()
    await openViaRequest()
    await rerender()

    expect(container?.textContent).toContain('Missing canonical agent skills root')
    expect(findButton('Update 1 skill')).toBeUndefined()
  })
})
