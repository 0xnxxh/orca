// @vitest-environment happy-dom

import '@testing-library/jest-dom/vitest'
import { cleanup, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type {
  TerminalLegacyPreservationFacts,
  TerminalLegacyRecoveryReason
} from '../../../../shared/terminal-legacy-cutover'
import { TerminalLegacyRecoveryBanner } from './TerminalLegacyRecoveryBanner'
import type {
  TerminalLegacyRecoveryNotice,
  TerminalLegacyUnresolvedRecoveryNotice
} from './terminal-legacy-recovery-view-model'

vi.mock('@/i18n/i18n', () => ({
  translate: (_key: string, fallback: string, options?: Record<string, unknown>) =>
    fallback.replace('{{value0}}', String(options?.value0 ?? '{{value0}}'))
}))

afterEach(cleanup)

const REDACTED_VALUES = {
  canonicalPath: '/Users/person/secret-project',
  workspaceId: 'folder:/Users/person/secret-project',
  paneId: 'secret-tab:secret-pane',
  ptyId: 'secret-physical-pty',
  processId: 9842,
  endpoint: '\\\\.\\pipe\\secret-legacy-relay',
  credential: '/Users/person/.orca/secret-credential',
  receiptId: 'secret-receipt',
  birthMarker: 'secret-process-birth-marker'
} as const

type WorkspaceKind = TerminalLegacyUnresolvedRecoveryNotice['workspaceKind']

function makeUnresolved(
  options: Readonly<{
    recoveryKey?: string
    reason?: TerminalLegacyRecoveryReason
    preservationKind?: TerminalLegacyPreservationFacts['kind']
    workspaceKind?: WorkspaceKind
    evidenceDigest?: string
    observedAtMs?: number
  }> = {}
): TerminalLegacyUnresolvedRecoveryNotice {
  return {
    recoveryKey: options.recoveryKey ?? 'recovery-key-a',
    status: 'unresolved',
    reason: options.reason ?? 'ambiguous-pane-generation',
    preservationKind: options.preservationKind ?? 'evidence-gc-retained',
    workspaceKind: options.workspaceKind ?? 'git-worktree',
    evidenceDigest: options.evidenceDigest ?? 'sha256:safe-support-digest',
    observedAtMs: options.observedAtMs ?? Date.UTC(2026, 7, 6, 10, 30),
    discoveredAtMs: Date.UTC(2026, 7, 6, 10, 31),
    updatedAtMs: Date.UTC(2026, 7, 6, 10, 32)
  }
}

function makeImported(): TerminalLegacyRecoveryNotice {
  return {
    recoveryKey: 'recovery-key-imported',
    status: 'imported',
    workspaceKind: 'folder',
    evidenceDigest: 'sha256:imported',
    observedAtMs: 100,
    discoveredAtMs: 101,
    updatedAtMs: 102
  }
}

function makeAcknowledged(): TerminalLegacyRecoveryNotice {
  return {
    ...makeUnresolved({ recoveryKey: 'recovery-key-acknowledged' }),
    status: 'acknowledged'
  }
}

function renderBanner(
  recoveries: readonly TerminalLegacyRecoveryNotice[],
  writeClipboardText = vi.fn<(text: string) => Promise<void>>().mockResolvedValue(undefined),
  rootClassName?: string
) {
  return render(
    <TerminalLegacyRecoveryBanner
      recoveries={recoveries}
      writeClipboardText={writeClipboardText}
      rootClassName={rootClassName}
    />
  )
}

async function revealDetails(): Promise<void> {
  await userEvent.setup().click(screen.getByRole('button', { name: 'Show details' }))
}

describe('TerminalLegacyRecoveryBanner summary', () => {
  it('shows one unresolved terminal without claiming a process outcome', () => {
    renderBanner([
      makeUnresolved({ preservationKind: 'isolated-grace-disabled', workspaceKind: 'folder' })
    ])

    expect(screen.getByText('Previous terminal needs review')).toBeInTheDocument()
    expect(screen.getByText(/did not attach to, stop, or replace it/)).toBeInTheDocument()
    expect(screen.getByText(/shutdown grace is disabled/)).toBeInTheDocument()
    expect(screen.queryByText('Folder workspace')).not.toBeInTheDocument()
  })

  it('counts only unresolved rows and distinguishes mixed preservation facts', () => {
    renderBanner([
      makeImported(),
      makeAcknowledged(),
      makeUnresolved({
        recoveryKey: 'unresolved-a',
        preservationKind: 'isolated-grace-disabled'
      }),
      makeUnresolved({ recoveryKey: 'unresolved-b', preservationKind: 'worker-unreachable' })
    ])

    expect(screen.getByText('2 previous terminals need review')).toBeInTheDocument()
    expect(screen.getByText(/did not attach to, stop, or replace them/)).toBeInTheDocument()
    expect(screen.getByText(/Some previous endpoints are isolated/)).toBeInTheDocument()
  })

  it('renders nothing when every row is resolved', () => {
    const { container } = renderBanner([makeImported(), makeAcknowledged()])
    expect(container).toBeEmptyDOMElement()
  })

  it.each([
    ['evidence-gc-retained', /retained the recovery evidence.*could not prove/s],
    ['worker-unreachable', /previous worker was unreachable.*could not prove/s],
    ['unsupported-platform', /platform could not provide.*could not prove/s]
  ] as const)('states the limits of %s preservation', (preservationKind, expected) => {
    renderBanner([makeUnresolved({ preservationKind })])
    expect(screen.getByText(expected)).toBeInTheDocument()
  })
})

describe('TerminalLegacyRecoveryBanner disclosure', () => {
  it('supports keyboard disclosure without resizing terminal layout', async () => {
    renderBanner([makeUnresolved()], undefined, 'bottom-16')
    const trigger = screen.getByRole('button', { name: 'Show details' })
    const root = document.querySelector('[data-terminal-legacy-recovery-banner]')

    expect(trigger).toHaveAttribute('aria-expanded', 'false')
    expect(root).toHaveClass('absolute', 'bottom-16')
    expect(screen.getByRole('status')).toHaveAttribute('aria-live', 'polite')

    trigger.focus()
    await userEvent.setup().keyboard('{Enter}')
    expect(screen.getByRole('button', { name: 'Hide details' })).toHaveAttribute(
      'aria-expanded',
      'true'
    )
    expect(screen.getByText('Evidence digest')).toBeInTheDocument()
  })

  it.each([
    ['ambiguous-pane-generation', 'Pane generation is ambiguous'],
    ['endpoint-identity-unproved', 'Endpoint identity could not be proved'],
    ['physical-pty-incarnation-unproved', 'Physical terminal identity could not be proved'],
    ['unsupported-platform', 'Platform proof is unavailable'],
    ['worker-unreachable', 'Previous terminal worker was unreachable'],
    ['workspace-mismatch', 'Workspace evidence did not match']
  ] as const)('labels the %s reason', async (reason, label) => {
    renderBanner([makeUnresolved({ reason })])
    await revealDetails()
    expect(screen.getByText(label)).toBeInTheDocument()
  })

  it.each([
    ['git-worktree', 'Git worktree'],
    ['folder', 'Folder workspace'],
    ['floating', 'Floating terminal']
  ] as const)('labels %s recovery evidence', async (workspaceKind, label) => {
    renderBanner([makeUnresolved({ workspaceKind })])
    await revealDetails()
    expect(screen.getByText(label)).toBeInTheDocument()
  })

  it('labels an extreme timestamp unavailable instead of throwing', async () => {
    renderBanner([makeUnresolved({ observedAtMs: Number.MAX_SAFE_INTEGER })])
    await revealDetails()
    expect(screen.getByText('Unavailable')).toBeInTheDocument()
  })

  it('exposes only disclosure and copy controls', async () => {
    renderBanner([makeUnresolved()])
    await revealDetails()

    expect(screen.getAllByRole('button').map((button) => button.textContent?.trim())).toEqual([
      'Hide details',
      'Copy details'
    ])
    expect(
      screen.queryByRole('button', {
        name: /attach|stop|kill|replace|respawn|restart|expire|dismiss|delete/i
      })
    ).not.toBeInTheDocument()
  })
})

describe('TerminalLegacyRecoveryBanner copy', () => {
  it('never projects unexpected catalog fields into the DOM or clipboard', async () => {
    const contaminatedUnresolved = { ...makeUnresolved(), ...REDACTED_VALUES }
    const contaminatedImported = { ...makeImported(), ...REDACTED_VALUES }
    const writeClipboardText = vi.fn<(text: string) => Promise<void>>().mockResolvedValue()
    const { container } = renderBanner(
      [contaminatedImported, contaminatedUnresolved],
      writeClipboardText
    )
    await revealDetails()
    await userEvent.setup().click(screen.getByRole('button', { name: 'Copy details' }))

    await waitFor(() => expect(writeClipboardText).toHaveBeenCalledOnce())
    expect(await screen.findByText('Recovery details copied.')).toBeInTheDocument()
    const copied = writeClipboardText.mock.calls[0][0]
    expect(JSON.parse(copied)).toEqual({
      kind: 'orca-terminal-legacy-recovery',
      formatVersion: 1,
      reason: 'ambiguous-pane-generation',
      preservationKind: 'evidence-gc-retained',
      workspaceKind: 'git-worktree',
      evidenceDigest: 'sha256:safe-support-digest',
      observedAtMs: Date.UTC(2026, 7, 6, 10, 30),
      discoveredAtMs: Date.UTC(2026, 7, 6, 10, 31),
      updatedAtMs: Date.UTC(2026, 7, 6, 10, 32)
    })
    for (const secret of Object.values(REDACTED_VALUES)) {
      expect(container.innerHTML).not.toContain(String(secret))
      expect(copied).not.toContain(String(secret))
    }
  })

  it('reports a failed copy inline and allows a retry', async () => {
    const writeClipboardText = vi
      .fn<(text: string) => Promise<void>>()
      .mockRejectedValueOnce(new Error('clipboard unavailable'))
      .mockResolvedValueOnce(undefined)
    renderBanner([makeUnresolved()], writeClipboardText)
    await revealDetails()
    const user = userEvent.setup()

    await user.click(screen.getByRole('button', { name: 'Copy details' }))
    expect(await screen.findByRole('alert')).toHaveTextContent(
      'Recovery details could not be copied. Try again.'
    )

    await user.click(screen.getByRole('button', { name: 'Copy details' }))
    expect(await screen.findByText('Recovery details copied.')).toBeInTheDocument()
    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
    expect(writeClipboardText).toHaveBeenCalledTimes(2)
  })
})
