import { afterEach, describe, expect, it, vi } from 'vitest'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { DaemonClient } from './client'
import { DaemonPtyAdapter } from './daemon-pty-adapter'
import {
  EXACT_PTY_OPERATIONS_DAEMON_PROTOCOL_VERSION,
  TERMINAL_SESSION_AUTHORITY_DAEMON_PROTOCOL_VERSION
} from './daemon-protocol-version'
import type { SessionInfo } from './types'
import { killListedPty } from '../providers/pty-listed-session-kill'
import type { TerminalSessionAuthorityPtyAccess } from '../../shared/terminal-session-authority-pty-access'

const adapters: DaemonPtyAdapter[] = []

afterEach(() => {
  for (const adapter of adapters.splice(0)) {
    adapter.dispose()
  }
  vi.restoreAllMocks()
})

describe('DaemonPtyAdapter authority inventory', () => {
  it('fails closed against v32 inventory without exact operations', async () => {
    const { adapter, request } = adapterWithInventory(
      EXACT_PTY_OPERATIONS_DAEMON_PROTOCOL_VERSION - 1,
      [listedSession('session-v32', 'incarnation-v32')]
    )

    const [listed] = await adapter.listProcesses()

    expect(listed).toBeDefined()
    await expect(killListedPty(adapter, listed!, { immediate: true })).resolves.toBe(false)
    expect(request.mock.calls.some(([type]) => type === 'killExact')).toBe(false)
    expect(request.mock.calls.some(([type]) => type === 'killAuthorityExact')).toBe(false)
  })

  it('uses the listed incarnation for v33 orphan-safe shutdown', async () => {
    const session = listedSession('session-v33', 'incarnation-v33')
    const { adapter, request } = adapterWithInventory(
      EXACT_PTY_OPERATIONS_DAEMON_PROTOCOL_VERSION,
      [session]
    )

    const [listed] = await adapter.listProcesses()

    await expect(killListedPty(adapter, listed!, { immediate: true })).resolves.toBe(true)
    expect(request).toHaveBeenCalledWith(
      'killExact',
      {
        sessionId: session.sessionId,
        incarnationId: session.incarnationId,
        immediate: true
      },
      undefined
    )
    expect(request.mock.calls.some(([type]) => type === 'kill')).toBe(false)
  })

  it('uses full authority access for v34 inventory shutdown', async () => {
    const access = authorityAccess('session-v34', 'incarnation-v34')
    const session = listedSession('session-v34', 'incarnation-v34', access)
    const { adapter, request } = adapterWithInventory(
      TERMINAL_SESSION_AUTHORITY_DAEMON_PROTOCOL_VERSION,
      [session]
    )

    const [listed] = await adapter.listProcesses()

    expect(listed?.terminalSessionAuthorityAccess).toEqual(access)
    await expect(killListedPty(adapter, listed!, { immediate: true })).resolves.toBe(true)
    expect(request).toHaveBeenCalledWith(
      'killAuthorityExact',
      { sessionId: session.sessionId, authorityAccess: access, immediate: true },
      undefined
    )
    expect(request.mock.calls.some(([type]) => type === 'killExact')).toBe(false)
    expect(request.mock.calls.some(([type]) => type === 'kill')).toBe(false)
  })

  it('upgrades every incarnation-only mutation to the cached authority access', async () => {
    const access = authorityAccess('authority-session', 'authority-incarnation')
    const { adapter, notify, request } = adapterWithInventory(
      TERMINAL_SESSION_AUTHORITY_DAEMON_PROTOCOL_VERSION,
      [listedSession('authority-session', 'authority-incarnation', access)]
    )
    await adapter.listProcesses()

    expect(adapter.bindTerminalSessionAuthorityAccess('authority-session', access)).toBe(true)
    expect(
      adapter.bindTerminalSessionAuthorityAccess(
        'authority-session',
        authorityAccess('authority-session', 'stale-incarnation')
      )
    ).toBe(false)
    expect(adapter.writeExact('authority-session', 'stale-incarnation', 'stale')).toBe(false)
    expect(adapter.resizeExact('authority-session', 'stale-incarnation', 90, 30)).toBe(false)
    await expect(
      adapter.sendSignalExact('authority-session', 'stale-incarnation', 'SIGTERM')
    ).resolves.toBe(false)
    await expect(adapter.clearBufferExact('authority-session', 'stale-incarnation')).resolves.toBe(
      false
    )
    await expect(
      adapter.killExact('authority-session', 'stale-incarnation', { immediate: true })
    ).resolves.toBe(false)

    expect(adapter.writeExact('authority-session', 'authority-incarnation', 'current')).toBe(true)
    expect(adapter.resizeExact('authority-session', 'authority-incarnation', 120, 40)).toBe(true)
    await expect(
      adapter.sendSignalExact('authority-session', 'authority-incarnation', 'SIGTERM')
    ).resolves.toBe(true)
    await expect(
      adapter.clearBufferExact('authority-session', 'authority-incarnation')
    ).resolves.toBe(true)
    await expect(
      adapter.killExact('authority-session', 'authority-incarnation', { immediate: true })
    ).resolves.toBe(true)

    expect(notify).toHaveBeenCalledWith('writeAuthorityExact', {
      sessionId: 'authority-session',
      authorityAccess: access,
      data: 'current'
    })
    expect(notify).toHaveBeenCalledWith('resizeAuthorityExact', {
      sessionId: 'authority-session',
      authorityAccess: access,
      cols: 120,
      rows: 40
    })
    expect(request.mock.calls.map(([type]) => type)).toEqual(
      expect.arrayContaining([
        'signalAuthorityExact',
        'clearBufferAuthorityExact',
        'killAuthorityExact'
      ])
    )
    expect(
      [...notify.mock.calls, ...request.mock.calls].some(
        ([type]) =>
          type === 'writeExact' ||
          type === 'resizeExact' ||
          type === 'signalExact' ||
          type === 'clearBufferExact' ||
          type === 'killExact'
      )
    ).toBe(false)
  })

  it('returns full authority and route evidence to Manage Sessions inventory', async () => {
    const access = authorityAccess('managed-session', 'managed-incarnation')
    const { adapter } = adapterWithInventory(TERMINAL_SESSION_AUTHORITY_DAEMON_PROTOCOL_VERSION, [
      listedSession('managed-session', 'managed-incarnation', access)
    ])

    const [listed] = await adapter.listSessions()

    expect(listed).toMatchObject({
      sessionId: 'managed-session',
      incarnationId: 'managed-incarnation',
      terminalSessionAuthorityAccess: access,
      mutationRouteToken: expect.any(Object)
    })
    expect(adapter.getPtyMutationRouteToken('managed-session')).toBe(listed?.mutationRouteToken)
  })

  it('reconciles authority-owned startup orphans without a legacy kill', async () => {
    const access = authorityAccess('missing-worktree@@pty', 'orphan-incarnation')
    const { adapter, request } = adapterWithInventory(
      TERMINAL_SESSION_AUTHORITY_DAEMON_PROTOCOL_VERSION,
      [listedSession('missing-worktree@@pty', 'orphan-incarnation', access)]
    )

    await expect(adapter.reconcileOnStartup(new Set())).resolves.toEqual({
      alive: [],
      killed: ['missing-worktree@@pty']
    })
    expect(request).toHaveBeenCalledWith('killAuthorityExact', {
      sessionId: 'missing-worktree@@pty',
      authorityAccess: access
    })
    expect(request.mock.calls.some(([type]) => type === 'kill')).toBe(false)
  })

  it('rejects authority access that does not bind the listed row', async () => {
    const mismatched = authorityAccess('different-session', 'incarnation-v34')
    const { adapter } = adapterWithInventory(TERMINAL_SESSION_AUTHORITY_DAEMON_PROTOCOL_VERSION, [
      listedSession('session-v34', 'incarnation-v34', mismatched)
    ])

    await expect(adapter.listProcesses()).rejects.toThrow(
      'daemon_terminal_session_authority_access_invalid'
    )
    expect(adapter.getPtyMutationRouteToken('session-v34')).toBeNull()
  })

  it('rejects an inventory downgrade for the same authority-owned incarnation', async () => {
    const access = authorityAccess('session-v34', 'incarnation-v34')
    let sessions = [listedSession('session-v34', 'incarnation-v34', access)]
    const { adapter } = adapterWithInventory(
      TERMINAL_SESSION_AUTHORITY_DAEMON_PROTOCOL_VERSION,
      () => sessions
    )
    const [first] = await adapter.listProcesses()
    sessions = [listedSession('session-v34', 'incarnation-v34')]

    await expect(adapter.listProcesses()).rejects.toThrow(
      'daemon_terminal_session_authority_access_missing'
    )
    expect(adapter.getPtyMutationRouteToken('session-v34')).toBe(first?.mutationRouteToken)
  })

  it('invalidates old authority when inventory proves a replacement incarnation', async () => {
    const oldAccess = authorityAccess('reused-session', 'old-incarnation')
    let sessions = [listedSession('reused-session', 'old-incarnation', oldAccess)]
    const { adapter, request } = adapterWithInventory(
      TERMINAL_SESSION_AUTHORITY_DAEMON_PROTOCOL_VERSION,
      () => sessions
    )
    const [oldListing] = await adapter.listProcesses()
    sessions = [listedSession('reused-session', 'new-incarnation')]
    const [replacement] = await adapter.listProcesses()

    await expect(killListedPty(adapter, oldListing!, { immediate: true })).resolves.toBe(false)
    await expect(killListedPty(adapter, replacement!, { immediate: true })).resolves.toBe(true)
    expect(request).toHaveBeenCalledWith(
      'killExact',
      {
        sessionId: 'reused-session',
        incarnationId: 'new-incarnation',
        immediate: true
      },
      undefined
    )
  })

  it('retains authority across disconnect but invalidates listed route tokens', async () => {
    const access = authorityAccess('reconnect-session', 'reconnect-incarnation')
    const { adapter, request, disconnect } = adapterWithInventory(
      TERMINAL_SESSION_AUTHORITY_DAEMON_PROTOCOL_VERSION,
      [listedSession('reconnect-session', 'reconnect-incarnation', access)]
    )
    const [listed] = await adapter.listProcesses()

    disconnect()

    expect(adapter.getPtyMutationRouteToken('reconnect-session')).toBeNull()
    await expect(killListedPty(adapter, listed!, { immediate: true })).resolves.toBe(false)
    await expect(
      adapter.killAuthorityExact('reconnect-session', access, { immediate: true })
    ).resolves.toBe(true)
    expect(request.mock.calls.some(([type]) => type === 'killAuthorityExact')).toBe(true)
  })

  it('forgets authority when daemon replacement fans out synthetic exits', async () => {
    const access = authorityAccess('replaced-session', 'replaced-incarnation')
    const { adapter, request } = adapterWithInventory(
      TERMINAL_SESSION_AUTHORITY_DAEMON_PROTOCOL_VERSION,
      [listedSession('replaced-session', 'replaced-incarnation', access)]
    )
    await adapter.listProcesses()

    adapter.fanoutSyntheticExits(-1)

    expect(adapter.bindTerminalSessionAuthorityAccess('replaced-session', access)).toBe(false)
    await expect(
      adapter.killAuthorityExact('replaced-session', access, { immediate: true })
    ).resolves.toBe(false)
    expect(request.mock.calls.some(([type]) => type === 'killAuthorityExact')).toBe(false)
  })
})

function adapterWithInventory(
  protocolVersion: number,
  sessions: SessionInfo[] | (() => SessionInfo[])
): {
  adapter: DaemonPtyAdapter
  request: ReturnType<typeof vi.spyOn>
  notify: ReturnType<typeof vi.spyOn>
  disconnect: () => void
} {
  vi.spyOn(DaemonClient.prototype, 'ensureConnected').mockResolvedValue()
  vi.spyOn(DaemonClient.prototype, 'supportsTerminalSessionAuthority').mockReturnValue(
    protocolVersion >= TERMINAL_SESSION_AUTHORITY_DAEMON_PROTOCOL_VERSION
  )
  const request = vi
    .spyOn(DaemonClient.prototype, 'request')
    .mockImplementation(async (type: string) => {
      if (type === 'listSessions') {
        return { sessions: typeof sessions === 'function' ? sessions() : sessions } as never
      }
      if (
        type === 'killExact' ||
        type === 'killAuthorityExact' ||
        type === 'signalAuthorityExact' ||
        type === 'clearBufferAuthorityExact'
      ) {
        return { accepted: true } as never
      }
      return {} as never
    })
  const notify = vi.spyOn(DaemonClient.prototype, 'notify').mockReturnValue(true)
  const adapter = new DaemonPtyAdapter({
    socketPath: join(tmpdir(), `orca-daemon-authority-${protocolVersion}.socket`),
    tokenPath: join(tmpdir(), `orca-daemon-authority-${protocolVersion}.token`),
    protocolVersion
  })
  adapters.push(adapter)
  const client = adapter as unknown as {
    client: { disconnectedListeners: (() => void)[] }
  }
  return {
    adapter,
    request,
    notify,
    disconnect: () => {
      for (const listener of client.client.disconnectedListeners) {
        listener()
      }
    }
  }
}

function listedSession(
  sessionId: string,
  incarnationId: string,
  access?: TerminalSessionAuthorityPtyAccess
): SessionInfo {
  return {
    sessionId,
    incarnationId,
    ...(access ? { terminalSessionAuthorityAccess: access } : {}),
    state: 'running',
    shellState: 'unsupported',
    isAlive: true,
    pid: 42,
    cwd: tmpdir(),
    cols: 80,
    rows: 24,
    createdAt: 1
  }
}

function authorityAccess(
  physicalPtyId: string,
  ptyIncarnationId: string
): TerminalSessionAuthorityPtyAccess {
  return {
    namespace: { authorityHostId: 'authority-host', namespaceId: 'namespace' },
    pane: { paneKey: 'pane', paneGenerationId: 'renderer:1' },
    binding: {
      ownerIncarnationId: 'owner-incarnation',
      physicalPtyId,
      ptyIncarnationId
    }
  }
}
