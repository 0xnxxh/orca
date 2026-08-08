import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { TerminalSessionAuthorityPtyAccess } from '../../shared/terminal-session-authority-pty-access'
import type { TerminalAuthorityAppNamespaceAdmission } from '../session-authority/terminal-authority-app-outcome-host-contract'
import { killListedPty } from './pty-listed-session-kill'
import { SshPtyProvider } from './ssh-pty-provider'

type MockMux = {
  request: ReturnType<typeof vi.fn>
  notify: ReturnType<typeof vi.fn>
  onNotification: ReturnType<typeof vi.fn>
  dispose: ReturnType<typeof vi.fn>
  isDisposed: ReturnType<typeof vi.fn>
  emitNotification: (method: string, params: Record<string, unknown>) => void
}

function createMux(
  incarnationId: string,
  terminalSessionAuthorityAccess?: TerminalSessionAuthorityPtyAccess
): MockMux {
  let notificationHandler: (method: string, params: Record<string, unknown>) => void = () => {}
  const mux: MockMux = {
    request: vi.fn(async (method: string) => {
      if (method === 'pty.spawn') {
        return {
          id: 'pty-1',
          incarnationId,
          ...(terminalSessionAuthorityAccess ? { terminalSessionAuthorityAccess } : {})
        }
      }
      return undefined
    }),
    notify: vi.fn().mockReturnValue(true),
    onNotification: vi.fn((handler: (method: string, params: Record<string, unknown>) => void) => {
      notificationHandler = handler
      return () => {}
    }),
    dispose: vi.fn(),
    isDisposed: vi.fn().mockReturnValue(false),
    emitNotification: (method, params) => notificationHandler(method, params)
  }
  return mux
}

const authorityAccess: TerminalSessionAuthorityPtyAccess = {
  namespace: { authorityHostId: 'host-1', namespaceId: 'namespace-1' },
  pane: { paneKey: 'pane-1', paneGenerationId: 'renderer:1' },
  binding: {
    ownerIncarnationId: 'owner-1',
    physicalPtyId: 'pty-1',
    ptyIncarnationId: 'incarnation-1'
  }
}

function exactCapability(isCurrentProviderGeneration: () => boolean) {
  return { version: 1 as const, isCurrentProviderGeneration }
}

async function spawn(provider: SshPtyProvider): Promise<string> {
  return (await provider.spawn({ cols: 80, rows: 24 })).id
}

describe('SshPtyProvider exact operations', () => {
  let mux: MockMux
  let current: boolean
  let provider: SshPtyProvider

  beforeEach(() => {
    mux = createMux('incarnation-1')
    current = true
    provider = new SshPtyProvider(
      'conn-1',
      mux as never,
      undefined,
      17,
      exactCapability(() => current)
    )
  })

  it('uses distinct exact methods without mutating legacy payloads', async () => {
    const id = await spawn(provider)
    mux.request.mockResolvedValueOnce([
      { id: 'pty-1', cwd: '/workspace', title: 'shell', incarnationId: 'incarnation-1' }
    ])
    const [listed] = await provider.listProcesses()
    expect(listed.mutationRouteToken).toBe(provider.getPtyMutationRouteToken(id))
    expect(listed.mutationRouteToken).not.toBeNull()
    mux.notify.mockClear()
    mux.request.mockClear()
    mux.request.mockResolvedValue({ accepted: true })

    provider.write(id, 'legacy-write')
    provider.resize(id, 100, 30)
    await provider.sendSignal(id, 'SIGINT')
    await provider.clearBuffer(id)
    expect(provider.writeExact(id, 'incarnation-1', 'exact-write')).toBe(true)
    expect(provider.resizeExact(id, 'incarnation-1', 120, 40)).toBe(true)
    await expect(provider.sendSignalExact(id, 'incarnation-1', 'SIGTERM')).resolves.toBe(true)
    await expect(provider.clearBufferExact(id, 'incarnation-1')).resolves.toBe(true)

    expect(mux.notify.mock.calls).toEqual([
      ['pty.data', { id: 'pty-1', data: 'legacy-write' }],
      ['pty.resize', { id: 'pty-1', cols: 100, rows: 30 }],
      ['pty.dataExact', { id: 'pty-1', incarnationId: 'incarnation-1', data: 'exact-write' }],
      ['pty.resizeExact', { id: 'pty-1', incarnationId: 'incarnation-1', cols: 120, rows: 40 }]
    ])
    expect(mux.request.mock.calls).toEqual([
      ['pty.sendSignal', { id: 'pty-1', signal: 'SIGINT' }],
      ['pty.clearBuffer', { id: 'pty-1' }],
      ['pty.sendSignalExact', { id: 'pty-1', incarnationId: 'incarnation-1', signal: 'SIGTERM' }],
      ['pty.clearBufferExact', { id: 'pty-1', incarnationId: 'incarnation-1' }]
    ])
  })

  it('dispatches legacy shutdown for a live pre-cutover route', async () => {
    const id = await spawn(provider)
    mux.request.mockClear()

    await expect(
      provider.shutdown(id, { immediate: true, keepHistory: true })
    ).resolves.toBeUndefined()
    expect(mux.request).toHaveBeenCalledWith(
      'pty.shutdown',
      {
        id: 'pty-1',
        immediate: true,
        keepHistory: true
      },
      undefined
    )
    expect(provider.hasPty(id)).toBe(false)
  })

  it('dispatches exact listed kill for a pre-cutover route token', async () => {
    const id = await spawn(provider)
    mux.request.mockResolvedValueOnce([
      { id: 'pty-1', cwd: '/workspace', title: 'shell', incarnationId: 'incarnation-1' }
    ])
    const [listed] = await provider.listProcesses()
    mux.request.mockClear()
    mux.request.mockResolvedValue({ accepted: true })

    await expect(killListedPty(provider, listed, { immediate: true })).resolves.toBe(true)
    expect(mux.request).toHaveBeenCalledWith('pty.shutdownExact', {
      id: 'pty-1',
      incarnationId: 'incarnation-1',
      immediate: true,
      keepHistory: false
    })
    expect(provider.hasPty(id)).toBe(false)
  })

  it('rejects a legacy listed token after its provider generation goes stale', async () => {
    const id = await spawn(provider)
    mux.request.mockResolvedValueOnce([
      { id: 'pty-1', cwd: '/workspace', title: 'shell', incarnationId: 'incarnation-1' }
    ])
    const [listed] = await provider.listProcesses()
    mux.request.mockClear()
    current = false

    await expect(killListedPty(provider, listed, { immediate: true })).resolves.toBe(false)
    expect(provider.getPtyMutationRouteToken(id)).toBeNull()
    expect(mux.request).not.toHaveBeenCalled()
  })

  it('fails closed before transport admission', async () => {
    const id = await spawn(provider)
    mux.notify.mockClear()

    expect(provider.writeExact(id, 'stale-incarnation', 'stale')).toBe(false)
    expect(provider.resizeExact(id, 'stale-incarnation', 120, 40)).toBe(false)
    await expect(provider.sendSignalExact(id, 'stale-incarnation', 'SIGTERM')).resolves.toBe(false)
    await expect(provider.clearBufferExact(id, 'stale-incarnation')).resolves.toBe(false)
    current = false
    expect(provider.supportsExactPtyOperations(id)).toBe(false)
    expect(provider.writeExact(id, 'incarnation-1', 'stale-generation')).toBe(false)
    await expect(provider.sendSignalExact(id, 'incarnation-1', 'SIGTERM')).resolves.toBe(false)
    await expect(provider.clearBufferExact(id, 'incarnation-1')).resolves.toBe(false)
    expect(mux.notify).not.toHaveBeenCalled()
    expect(mux.request).toHaveBeenCalledOnce()

    current = true
    mux.notify.mockReturnValueOnce(false)
    expect(provider.writeExact(id, 'incarnation-1', 'unadmitted')).toBe(false)
  })

  it('keeps live state unless exact shutdown is accepted', async () => {
    const id = await spawn(provider)
    mux.request.mockResolvedValueOnce({ accepted: false }).mockResolvedValueOnce({ accepted: true })

    await expect(provider.killExact(id, 'stale-incarnation', {})).resolves.toBe(false)
    expect(mux.request).toHaveBeenCalledTimes(1)
    await expect(provider.killExact(id, 'incarnation-1', { immediate: true })).resolves.toBe(false)
    expect(provider.hasPty(id)).toBe(true)
    await expect(provider.killExact(id, 'incarnation-1', { immediate: true })).resolves.toBe(true)
    expect(provider.hasPty(id)).toBe(false)
    expect(mux.request).toHaveBeenLastCalledWith('pty.shutdownExact', {
      id: 'pty-1',
      incarnationId: 'incarnation-1',
      immediate: true,
      keepHistory: false
    })
  })

  it('preserves the caller cleanup deadline for exact shutdown', async () => {
    const id = await spawn(provider)
    mux.request.mockClear()
    mux.request.mockResolvedValue({ accepted: true })
    const now = Date.now()
    const nowSpy = vi.spyOn(Date, 'now').mockReturnValue(now)
    try {
      await expect(
        provider.killExact(id, 'incarnation-1', { immediate: true, deadlineMs: now + 2_500 })
      ).resolves.toBe(true)

      expect(mux.request).toHaveBeenCalledWith(
        'pty.shutdownExact',
        {
          id: 'pty-1',
          incarnationId: 'incarnation-1',
          immediate: true,
          keepHistory: false
        },
        { timeoutMs: 2_500 }
      )
    } finally {
      nowSpy.mockRestore()
    }
  })

  it('does not clear a replacement incarnation when an old shutdown settles late', async () => {
    const id = await spawn(provider)
    let settleShutdown!: (result: { accepted: true }) => void
    mux.request.mockReturnValueOnce(
      new Promise((resolve) => {
        settleShutdown = resolve
      })
    )
    const shutdown = provider.killExact(id, 'incarnation-1', {})
    mux.emitNotification('pty.exit', {
      id: 'pty-1',
      code: 0,
      incarnationId: 'incarnation-1'
    })
    mux.request.mockResolvedValueOnce({ id: 'pty-1', incarnationId: 'incarnation-2' })
    const replacementId = await spawn(provider)

    settleShutdown({ accepted: true })
    await expect(shutdown).resolves.toBe(true)
    expect(provider.hasPty(replacementId)).toBe(true)
    expect(provider.writeExact(replacementId, 'incarnation-2', 'current')).toBe(true)
  })

  it('keeps old peers on legacy operations', async () => {
    const legacyMux = createMux('incarnation-1')
    const legacy = new SshPtyProvider('conn-1', legacyMux as never)
    const id = await spawn(legacy)
    legacyMux.notify.mockClear()

    expect(legacy.supportsExactPtyOperations(id)).toBe(false)
    expect(legacy.writeExact(id, 'incarnation-1', 'blocked')).toBe(false)
    await expect(legacy.killExact(id, 'incarnation-1', {})).resolves.toBe(false)
    await expect(legacy.sendSignalExact(id, 'incarnation-1', 'SIGTERM')).resolves.toBe(false)
    await expect(legacy.clearBufferExact(id, 'incarnation-1')).resolves.toBe(false)
    expect(legacyMux.notify).not.toHaveBeenCalled()
    expect(legacyMux.request).toHaveBeenCalledOnce()
  })

  it('fences disposed and replacement provider generations', async () => {
    const oldId = await spawn(provider)
    provider.dispose()
    expect(provider.writeExact(oldId, 'incarnation-1', 'disposed')).toBe(false)

    const replacementMux = createMux('incarnation-2')
    const replacement = new SshPtyProvider(
      'conn-1',
      replacementMux as never,
      undefined,
      18,
      exactCapability(() => true)
    )
    const replacementId = await spawn(replacement)
    replacementMux.notify.mockClear()

    expect(replacement.writeExact(replacementId, 'incarnation-1', 'stale')).toBe(false)
    expect(replacement.writeExact(replacementId, 'incarnation-2', 'current')).toBe(true)
    expect(replacementMux.notify).toHaveBeenCalledOnce()
  })
})

describe('SshPtyProvider authority exact operations', () => {
  function authorityProvider(
    mux: MockMux,
    authorityCurrent = () => true,
    legacyCurrent = () => true
  ): SshPtyProvider {
    return new SshPtyProvider(
      'conn-1',
      mux as never,
      undefined,
      17,
      exactCapability(legacyCurrent),
      false,
      exactCapability(authorityCurrent)
    )
  }

  it('carries one captured full binding through all five mutations', async () => {
    const mux = createMux('incarnation-1', authorityAccess)
    const provider = authorityProvider(mux)
    const id = await spawn(provider)
    mux.notify.mockClear()
    mux.request.mockClear()
    mux.request.mockResolvedValue({ accepted: true })

    expect(provider.getPtyMutationMode(id)).toBe('exact')
    expect(provider.supportsExactPtyOperations(id)).toBe(true)
    expect(provider.writeAuthorityExact(id, authorityAccess, 'input')).toBe(true)
    expect(provider.resizeAuthorityExact(id, authorityAccess, 120, 40)).toBe(true)
    await expect(provider.sendSignalAuthorityExact(id, authorityAccess, 'SIGTERM')).resolves.toBe(
      true
    )
    await expect(provider.clearBufferAuthorityExact(id, authorityAccess)).resolves.toBe(true)
    await expect(
      provider.killAuthorityExact(id, authorityAccess, { immediate: true })
    ).resolves.toBe(true)

    expect(mux.notify.mock.calls).toEqual([
      [
        'pty.dataAuthorityExact',
        { id: 'pty-1', terminalSessionAuthorityAccess: authorityAccess, data: 'input' }
      ],
      [
        'pty.resizeAuthorityExact',
        {
          id: 'pty-1',
          terminalSessionAuthorityAccess: authorityAccess,
          cols: 120,
          rows: 40
        }
      ]
    ])
    expect(mux.request.mock.calls).toEqual([
      [
        'pty.sendSignalAuthorityExact',
        {
          id: 'pty-1',
          terminalSessionAuthorityAccess: authorityAccess,
          signal: 'SIGTERM'
        }
      ],
      [
        'pty.clearBufferAuthorityExact',
        { id: 'pty-1', terminalSessionAuthorityAccess: authorityAccess }
      ],
      [
        'pty.shutdownAuthorityExact',
        {
          id: 'pty-1',
          terminalSessionAuthorityAccess: authorityAccess,
          immediate: true,
          keepHistory: false
        }
      ]
    ])
    expect(provider.hasPty(id)).toBe(true)
    mux.emitNotification('pty.exit', {
      id: 'pty-1',
      code: 0,
      incarnationId: 'incarnation-1'
    })
    expect(provider.hasPty(id)).toBe(false)
  })

  it('rejects every stale full binding before transport dispatch', async () => {
    const mux = createMux('incarnation-1', authorityAccess)
    const provider = authorityProvider(mux)
    const id = await spawn(provider)
    const stale = {
      ...authorityAccess,
      pane: { ...authorityAccess.pane, paneGenerationId: 'renderer:2' }
    }
    mux.notify.mockClear()
    mux.request.mockClear()

    expect(provider.writeAuthorityExact(id, stale, 'stale')).toBe(false)
    expect(provider.resizeAuthorityExact(id, stale, 120, 40)).toBe(false)
    await expect(provider.sendSignalAuthorityExact(id, stale, 'SIGTERM')).resolves.toBe(false)
    await expect(provider.clearBufferAuthorityExact(id, stale)).resolves.toBe(false)
    await expect(provider.killAuthorityExact(id, stale, {})).resolves.toBe(false)

    expect(mux.notify).not.toHaveBeenCalled()
    expect(mux.request).not.toHaveBeenCalled()
    expect(provider.hasPty(id)).toBe(true)
  })

  it('fails closed without a negotiated authority capability', async () => {
    const mux = createMux('incarnation-1', authorityAccess)
    const provider = new SshPtyProvider(
      'conn-1',
      mux as never,
      undefined,
      17,
      exactCapability(() => true)
    )
    const id = await spawn(provider)
    mux.notify.mockClear()
    mux.request.mockClear()

    expect(provider.getPtyMutationMode(id)).toBe('unavailable')
    expect(provider.writeAuthorityExact(id, authorityAccess, 'blocked')).toBe(false)
    expect(provider.writeExact(id, 'incarnation-1', 'blocked')).toBe(false)
    provider.write(id, 'blocked')
    await expect(provider.sendSignal(id, 'SIGTERM')).rejects.toThrow(
      'terminal_authority_exact_operation_required'
    )
    await expect(provider.killExact(id, 'incarnation-1', {})).resolves.toBe(false)

    expect(mux.notify).not.toHaveBeenCalled()
    expect(mux.request).not.toHaveBeenCalled()
  })

  it('keeps a cutover route unavailable when expected authority access is missing', async () => {
    const mux = createMux('incarnation-1')
    const provider = authorityProvider(mux)
    const id = await spawn(provider)
    const unprovedAccess = {
      ...authorityAccess,
      binding: { ...authorityAccess.binding, ptyIncarnationId: 'stale-incarnation' }
    }

    expect(provider.bindTerminalSessionAuthorityAccess(id, unprovedAccess)).toBe(false)
    mux.notify.mockClear()
    mux.request.mockClear()

    expect(provider.getPtyMutationMode(id)).toBe('unavailable')
    expect(provider.getPtyMutationRouteToken(id)).toBeNull()
    expect(provider.writeAuthorityExact(id, authorityAccess, 'blocked')).toBe(false)
    expect(provider.writeExact(id, 'incarnation-1', 'blocked')).toBe(false)
    provider.write(id, 'blocked')
    await expect(provider.sendSignal(id, 'SIGTERM')).rejects.toThrow(
      'terminal_authority_exact_operation_required'
    )
    await expect(provider.clearBuffer(id)).rejects.toThrow(
      'terminal_authority_exact_operation_required'
    )
    await expect(provider.killExact(id, 'incarnation-1', {})).resolves.toBe(false)

    expect(mux.notify).not.toHaveBeenCalled()
    expect(mux.request).not.toHaveBeenCalled()
  })

  it('never retries an authority rejection through incarnation methods', async () => {
    const mux = createMux('incarnation-1', authorityAccess)
    const provider = authorityProvider(mux)
    const id = await spawn(provider)
    mux.notify.mockClear()
    mux.request.mockClear()
    mux.request.mockResolvedValue({ accepted: false })

    await expect(provider.killAuthorityExact(id, authorityAccess, {})).resolves.toBe(false)
    expect(provider.writeExact(id, 'incarnation-1', 'blocked')).toBe(false)
    await expect(provider.sendSignalExact(id, 'incarnation-1', 'SIGTERM')).resolves.toBe(false)

    expect(mux.request).toHaveBeenCalledOnce()
    expect(mux.request).toHaveBeenCalledWith(
      'pty.shutdownAuthorityExact',
      expect.objectContaining({ terminalSessionAuthorityAccess: authorityAccess })
    )
    expect(mux.notify).not.toHaveBeenCalled()
    expect(provider.hasPty(id)).toBe(true)
  })

  it('admits the resolved app consumer before dispatching an authoritative spawn', async () => {
    const order: string[] = []
    const mux = createMux('incarnation-1', authorityAccess)
    mux.request.mockImplementation(async (method: string) => {
      order.push(`request:${method}`)
      return method === 'pty.spawn'
        ? {
            id: 'pty-1',
            incarnationId: 'incarnation-1',
            terminalSessionAuthorityAccess: authorityAccess
          }
        : undefined
    })
    const admission: TerminalAuthorityAppNamespaceAdmission = {
      admitNamespace: vi.fn(async () => {}),
      resolveAndAdmitNamespace: vi.fn(async () => authorityAccess.namespace),
      withSourceAdmission: vi.fn(async (locator, operation) => {
        expect(locator).toEqual({ worktreeId: 'repo::/workspace' })
        order.push('admit')
        const result = await operation({
          namespace: authorityAccess.namespace,
          assertCurrent: vi.fn()
        })
        order.push('release')
        return result
      })
    }
    const provider = new SshPtyProvider(
      'conn-1',
      mux as never,
      undefined,
      17,
      undefined,
      false,
      exactCapability(() => true),
      undefined,
      admission
    )

    await provider.spawn({
      cols: 80,
      rows: 24,
      worktreeId: 'repo::/workspace',
      paneGeneration: 1
    })

    expect(admission.withSourceAdmission).toHaveBeenCalledOnce()
    expect(order).toEqual(['admit', 'request:pty.spawn', 'release'])
  })

  it('re-admits a durable authority namespace before reconnect attach', async () => {
    const relayPtyId = 'pty-1'
    const reconnectAccess: TerminalSessionAuthorityPtyAccess = {
      ...authorityAccess,
      binding: { ...authorityAccess.binding, physicalPtyId: relayPtyId }
    }
    const mux = createMux('incarnation-1')
    const order: string[] = []
    mux.request.mockImplementation(async (method: string) => {
      order.push(`request:${method}`)
      return method === 'pty.attach'
        ? { incarnationId: 'incarnation-1', terminalSessionAuthorityAccess: reconnectAccess }
        : undefined
    })
    const admission: TerminalAuthorityAppNamespaceAdmission = {
      admitNamespace: vi.fn(async () => {}),
      resolveAndAdmitNamespace: vi.fn(async () => reconnectAccess.namespace),
      withSourceAdmission: vi.fn(async (locator, operation) => {
        expect(locator).toEqual({ namespace: reconnectAccess.namespace })
        order.push('admit')
        const result = await operation({
          namespace: reconnectAccess.namespace,
          assertCurrent: vi.fn()
        })
        order.push('release')
        return result
      })
    }
    const provider = new SshPtyProvider(
      'conn-1',
      mux as never,
      undefined,
      17,
      undefined,
      false,
      exactCapability(() => true),
      undefined,
      admission
    )

    await provider.attachForReconnect('ssh:conn-1@@pty-1', {
      terminalSessionAuthorityAccess: reconnectAccess
    })

    expect(admission.withSourceAdmission).toHaveBeenCalledOnce()
    expect(order).toEqual(['admit', 'request:pty.attach', 'release'])
    expect(mux.request).toHaveBeenCalledWith(
      'pty.attach',
      { id: relayPtyId, suppressReplayNotification: true },
      expect.objectContaining({ timeoutMs: 10_000 })
    )
  })
})
