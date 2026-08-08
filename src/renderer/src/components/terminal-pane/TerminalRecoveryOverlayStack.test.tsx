// @vitest-environment happy-dom

import '@testing-library/jest-dom/vitest'
import { cleanup, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { TerminalLegacyRecoveryNotice } from './terminal-legacy-recovery-view-model'

vi.mock('@/i18n/i18n', () => ({
  translate: (_key: string, fallback: string) => fallback
}))

vi.mock('./TerminalSshReconnectOverlay', () => ({
  TerminalSshReconnectOverlay: ({ rootClassName }: { rootClassName?: string }) => (
    <div className={rootClassName} data-testid="ssh-reconnect" />
  )
}))

import { TerminalRecoveryOverlayStack } from './TerminalRecoveryOverlayStack'

afterEach(cleanup)

function unresolvedNotice(): TerminalLegacyRecoveryNotice {
  return {
    recoveryKey: 'recovery-key-a',
    status: 'unresolved',
    reason: 'worker-unreachable',
    preservationKind: 'worker-unreachable',
    workspaceKind: 'folder',
    evidenceDigest: 'sha256:support',
    observedAtMs: 100,
    discoveredAtMs: 101,
    updatedAtMs: 102
  }
}

function importedNotice(): TerminalLegacyRecoveryNotice {
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

const SSH_RECONNECT = {
  targetId: 'ssh-target-1',
  targetLabel: 'devbox',
  status: 'disconnected' as const
}

describe('TerminalRecoveryOverlayStack', () => {
  it('stacks legacy recovery above SSH chrome without entering terminal layout', () => {
    const { container } = render(
      <TerminalRecoveryOverlayStack
        legacyRecoveries={[unresolvedNotice()]}
        sshReconnect={SSH_RECONNECT}
      />
    )

    const stack = container.querySelector('[data-terminal-recovery-overlay-stack]')
    const legacy = container.querySelector('[data-terminal-legacy-recovery-banner]')
    const ssh = screen.getByTestId('ssh-reconnect')
    expect(stack).toHaveClass('absolute', 'bottom-3', 'flex-col', 'gap-2')
    expect(legacy).toHaveClass('relative', 'inset-x-auto', 'bottom-auto', 'z-auto', 'w-full')
    expect(legacy).not.toHaveClass('absolute', 'bottom-3')
    expect(ssh).toHaveClass('relative', 'inset-x-auto', 'bottom-auto', 'z-auto', 'w-full')
    expect(stack?.children[0]).toBe(legacy)
    expect(stack?.children[1]).toBe(ssh)
  })

  it('keeps SSH at the bottom when resolved legacy rows are present', () => {
    const { container } = render(
      <TerminalRecoveryOverlayStack
        legacyRecoveries={[importedNotice()]}
        sshReconnect={SSH_RECONNECT}
      />
    )

    expect(container.querySelector('[data-terminal-legacy-recovery-banner]')).toBeNull()
    expect(screen.getByTestId('ssh-reconnect')).toBeInTheDocument()
  })

  it('renders no overlay root without unresolved recovery or reconnect chrome', () => {
    const { container } = render(
      <TerminalRecoveryOverlayStack legacyRecoveries={[importedNotice()]} sshReconnect={null} />
    )
    expect(container).toBeEmptyDOMElement()
  })
})
