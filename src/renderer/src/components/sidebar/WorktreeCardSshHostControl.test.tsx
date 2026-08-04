// @vitest-environment happy-dom

import '@testing-library/jest-dom/vitest'

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { cleanup, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { WorktreeCardSshHostControl } from './WorktreeCardSshHostControl'
import { useAppStore } from '@/store'
import { resetSshConnectInFlightForTests } from '@/ssh/ssh-connect-in-flight'
import type { SshConnectionState } from '../../../../shared/ssh-types'

const toastMocks = vi.hoisted(() => ({ error: vi.fn() }))

const environmentSshMocks = vi.hoisted(() => ({
  connectRuntimeEnvironmentSshTarget: vi.fn(),
  resyncRuntimeEnvironmentSshTargets: vi.fn()
}))

vi.mock('sonner', () => ({ toast: { error: toastMocks.error } }))

vi.mock('@/runtime/runtime-environment-ssh-state', () => environmentSshMocks)

vi.mock('@/i18n/i18n', () => ({
  translate: (_key: string, fallback: string, values?: Record<string, string>) =>
    fallback.replace('{{value0}}', values?.value0 ?? '')
}))

vi.mock('@/components/ui/tooltip', () => ({
  Tooltip: ({ children }: { children: React.ReactNode }) => <>{children}</>,
  TooltipContent: ({ children }: { children: React.ReactNode }) => (
    <span data-tooltip="">{children}</span>
  ),
  TooltipTrigger: ({ children }: { children: React.ReactNode }) => <>{children}</>
}))

function installSshApi(
  connect: ReturnType<typeof vi.fn>,
  overrides: Record<string, ReturnType<typeof vi.fn>> = {}
): void {
  Object.defineProperty(window, 'api', {
    configurable: true,
    value: {
      ssh: {
        connect,
        listTargets: vi.fn().mockResolvedValue([]),
        listRemovedTargetLabels: vi.fn().mockResolvedValue({}),
        ...overrides
      }
    }
  })
}

function renderControl(
  props: Partial<React.ComponentProps<typeof WorktreeCardSshHostControl>> = {}
) {
  return render(
    <WorktreeCardSshHostControl
      targetId="ssh-target-1"
      targetLabel="devbox"
      status="disconnected"
      targetRemoved={false}
      sshOwnerEnvironmentId={null}
      iconOnly={false}
      onPointerDown={() => {}}
      {...props}
    />
  )
}

describe('WorktreeCardSshHostControl', () => {
  beforeEach(() => {
    useAppStore.setState(useAppStore.getInitialState(), true)
    resetSshConnectInFlightForTests()
    toastMocks.error.mockReset()
    environmentSshMocks.connectRuntimeEnvironmentSshTarget.mockReset()
    environmentSshMocks.resyncRuntimeEnvironmentSshTargets.mockReset()
    installSshApi(vi.fn().mockResolvedValue(undefined))
  })

  afterEach(() => {
    cleanup()
  })

  it('offers a Connect control naming the host for a disconnected target', () => {
    renderControl()

    expect(screen.getByRole('button', { name: 'Connect to SSH host devbox' })).toBeEnabled()
  })

  // Why: the verb must match the terminal overlay, host-header menu, and status-bar row.
  it.each([
    ['auth-failed', 'Reconnect'],
    ['error', 'Retry'],
    ['reconnection-failed', 'Retry'],
    ['disconnected', 'Connect']
  ] as const)('labels the %s state %s', (status, verb) => {
    renderControl({ status })

    expect(screen.getByRole('button')).toHaveTextContent(verb)
  })

  it('distinguishes an auth failure from a generic connection failure in the tooltip', () => {
    const { container } = renderControl({ status: 'auth-failed' })
    expect(container.querySelector('[data-tooltip]')).toHaveTextContent(
      'devbox · authentication failed'
    )

    cleanup()
    const retry = renderControl({ status: 'error' })
    expect(retry.container.querySelector('[data-tooltip]')).toHaveTextContent(
      'devbox · connection failed'
    )
  })

  it.each(['error', 'reconnection-failed', 'auth-failed'] as const)(
    'tints the %s state with the destructive token, not the quiet one',
    (status) => {
      renderControl({ status })

      expect(screen.getByRole('button')).toHaveClass('text-destructive')
    }
  )

  it.each(['connecting', 'deploying-relay', 'reconnecting'] as const)(
    'shows a disabled busy control while the host is %s',
    (status) => {
      renderControl({ status })

      const button = screen.getByRole('button', { name: 'Connecting to SSH host devbox' })
      expect(button).toBeDisabled()
      expect(button).toHaveAttribute('aria-busy', 'true')
    }
  )

  it('renders the passive host glyph, not a control, when connected', () => {
    renderControl({ status: 'connected' })

    expect(screen.queryByRole('button')).not.toBeInTheDocument()
    expect(screen.getByText('Project on SSH host devbox')).toBeInTheDocument()
  })

  // Why: runtime-owned targets deliberately have no renderer-visible status; the card has
  // always shown the plain host glyph there rather than a false disconnected state.
  it('renders the passive host glyph for a null status', () => {
    renderControl({ status: null })

    expect(screen.queryByRole('button')).not.toBeInTheDocument()
    expect(screen.getByText('Project on SSH host devbox')).toBeInTheDocument()
  })

  // Why: this is the exact bug targetRemoved exists to prevent — a Connect that can only fail.
  it('never offers Connect for a removed host, even in a failed state', () => {
    renderControl({ status: 'error', targetRemoved: true })

    expect(screen.queryByRole('button')).not.toBeInTheDocument()
    expect(screen.getByText('SSH host devbox was removed')).toBeInTheDocument()
  })

  it('keeps the label available to assistive tech but not on screen in icon-only mode', () => {
    renderControl({ iconOnly: true })

    const button = screen.getByRole('button', { name: 'Connect to SSH host devbox' })
    expect(button.querySelector('.sr-only')).toHaveTextContent('Connect')
    expect(button).toHaveClass('w-4')
  })

  it('connects and mirrors the returned state so deferred PTY reattach can resume', async () => {
    const connectedState: SshConnectionState = {
      targetId: 'ssh-target-1',
      status: 'connected',
      error: null,
      reconnectAttempt: 0,
      remotePlatform: 'linux'
    }
    const connect = vi.fn().mockResolvedValue(connectedState)
    installSshApi(connect)
    const user = userEvent.setup()
    renderControl()

    await user.click(screen.getByRole('button'))

    expect(connect).toHaveBeenCalledWith({ targetId: 'ssh-target-1' })
    await waitFor(() =>
      expect(useAppStore.getState().sshConnectionStates.get('ssh-target-1')).toEqual(connectedState)
    )
  })

  // Why: reconnecting a host and navigating to its workspace are separate intents; the
  // control sits inside the card's own click target.
  it('does not activate the surrounding card when clicked', async () => {
    const onCardClick = vi.fn()
    const user = userEvent.setup()
    render(
      <div onClick={onCardClick}>
        <WorktreeCardSshHostControl
          targetId="ssh-target-1"
          targetLabel="devbox"
          status="disconnected"
          targetRemoved={false}
          sshOwnerEnvironmentId={null}
          iconOnly={false}
          onPointerDown={() => {}}
        />
      </div>
    )

    await user.click(screen.getByRole('button'))

    expect(onCardClick).not.toHaveBeenCalled()
  })

  it('reports connect failures and resyncs target metadata so a ghost host converges', async () => {
    const connect = vi.fn().mockRejectedValue(new Error('SSH target "ssh-target-1" not found'))
    const listTargets = vi
      .fn()
      .mockResolvedValue([
        { id: 'ssh-live', label: 'devbox', host: 'devbox', port: 22, username: 'me' }
      ])
    const listRemovedTargetLabels = vi
      .fn()
      .mockResolvedValue({ 'ssh-target-1': 'devbox (removed)' })
    installSshApi(connect, { listTargets, listRemovedTargetLabels })
    const user = userEvent.setup()
    renderControl()

    await user.click(screen.getByRole('button'))

    await waitFor(() =>
      expect(toastMocks.error).toHaveBeenCalledWith('SSH target "ssh-target-1" not found')
    )
    await waitFor(() => {
      expect(useAppStore.getState().sshTargetLabels.get('ssh-live')).toBe('devbox')
      expect(useAppStore.getState().removedSshTargetLabels.get('ssh-target-1')).toBe(
        'devbox (removed)'
      )
    })
  })

  it('routes connect to the owning Orca server for a remote-owned target', async () => {
    const connect = vi.fn().mockResolvedValue(undefined)
    installSshApi(connect)
    environmentSshMocks.connectRuntimeEnvironmentSshTarget.mockResolvedValue(null)
    const user = userEvent.setup()
    renderControl({ sshOwnerEnvironmentId: 'env-1' })

    await user.click(screen.getByRole('button'))

    await waitFor(() =>
      expect(environmentSshMocks.connectRuntimeEnvironmentSshTarget).toHaveBeenCalledWith(
        'env-1',
        'ssh-target-1'
      )
    )
    // The local ssh API must never see a remote host's target.
    expect(connect).not.toHaveBeenCalled()
  })

  // Why: N cards can share one host, and a passphrase-gated target would prompt N times.
  it('suppresses a sibling card dialing a host that is already connecting', async () => {
    const connect = vi.fn().mockReturnValue(new Promise(() => {}))
    installSshApi(connect)
    const user = userEvent.setup()
    render(
      <>
        <WorktreeCardSshHostControl
          targetId="ssh-target-1"
          targetLabel="devbox"
          status="disconnected"
          targetRemoved={false}
          sshOwnerEnvironmentId={null}
          iconOnly={false}
          onPointerDown={() => {}}
        />
        <WorktreeCardSshHostControl
          targetId="ssh-target-1"
          targetLabel="devbox"
          status="disconnected"
          targetRemoved={false}
          sshOwnerEnvironmentId={null}
          iconOnly={false}
          onPointerDown={() => {}}
        />
      </>
    )

    const [first, second] = screen.getAllByRole('button')
    await user.click(first)

    await waitFor(() => expect(second).toBeDisabled())
    expect(connect).toHaveBeenCalledTimes(1)
  })

  it('keeps the pill 16px tall in every state so the title row never shifts', () => {
    const heights = new Set<string>()
    for (const status of ['disconnected', 'error', 'connecting'] as const) {
      cleanup()
      renderControl({ status })
      const classes = screen.getByRole('button').className
      heights.add(classes.split(' ').find((token) => token.startsWith('h-')) ?? 'none')
    }

    expect([...heights]).toEqual(['h-4'])
  })
})
