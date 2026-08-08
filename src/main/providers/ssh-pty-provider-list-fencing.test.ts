import { describe, expect, it, vi } from 'vitest'
import { SshPtyProvider } from './ssh-pty-provider'

function deferred<T>() {
  let resolve!: (value: T) => void
  const promise = new Promise<T>((settle) => {
    resolve = settle
  })
  return { promise, resolve }
}

function createMux() {
  let notification: ((method: string, params: Record<string, unknown>) => void) | undefined
  return {
    mux: {
      request: vi.fn(),
      notify: vi.fn(),
      onNotification: vi.fn((listener) => {
        notification = listener
        return vi.fn()
      }),
      dispose: vi.fn(),
      isDisposed: vi.fn(() => false)
    },
    notify(method: string, params: Record<string, unknown>) {
      notification?.(method, params)
    }
  }
}

const authorityAccess = {
  namespace: { authorityHostId: 'host-1', namespaceId: 'namespace-1' },
  pane: { paneKey: 'pane-1', paneGenerationId: 'renderer:1' },
  binding: {
    ownerIncarnationId: 'owner-1',
    physicalPtyId: 'pty-1',
    ptyIncarnationId: 'incarnation-1'
  }
}

describe('SshPtyProvider process-list fencing', () => {
  it('does not resurrect a row whose exit arrives while its list request is pending', async () => {
    const { mux, notify } = createMux()
    const pendingList = deferred<unknown[]>()
    mux.request
      .mockResolvedValueOnce([
        { id: 'pty-1', cwd: '/repo', title: 'shell', incarnationId: 'incarnation-1' }
      ])
      .mockReturnValueOnce(pendingList.promise)
    const provider = new SshPtyProvider('conn-1', mux as never)
    await provider.listProcesses()

    const listing = provider.listProcesses()
    notify('pty.exit', { id: 'pty-1', code: 0, incarnationId: 'incarnation-1' })
    pendingList.resolve([
      { id: 'pty-1', cwd: '/repo', title: 'shell', incarnationId: 'incarnation-1' }
    ])

    await expect(listing).resolves.toEqual([])
    expect(provider.hasPty('ssh:conn-1@@pty-1')).toBe(false)
  })

  it('does not erase a concurrent spawn with an older empty inventory', async () => {
    const { mux } = createMux()
    const pendingList = deferred<unknown[]>()
    mux.request.mockImplementation((method: string) =>
      method === 'pty.listProcesses'
        ? pendingList.promise
        : Promise.resolve({ id: 'pty-new', incarnationId: 'incarnation-new' })
    )
    const provider = new SshPtyProvider('conn-1', mux as never)

    const listing = provider.listProcesses()
    const spawn = await provider.spawn({ cols: 80, rows: 24 })
    pendingList.resolve([])

    await expect(listing).resolves.toEqual([])
    expect(provider.hasPty(spawn.id)).toBe(true)
  })

  it('does not erase a successful reattach with an older empty inventory', async () => {
    const { mux } = createMux()
    const pendingList = deferred<unknown[]>()
    let listRequests = 0
    mux.request.mockImplementation((method: string) => {
      if (method !== 'pty.listProcesses') {
        return Promise.resolve({ incarnationId: 'incarnation-1' })
      }
      listRequests += 1
      return listRequests === 1
        ? Promise.resolve([{ id: 'pty-1', cwd: '/repo', title: 'shell' }])
        : pendingList.promise
    })
    const provider = new SshPtyProvider('conn-1', mux as never)
    await provider.listProcesses()

    const listing = provider.listProcesses()
    await provider.attach('ssh:conn-1@@pty-1')
    pendingList.resolve([])

    await expect(listing).resolves.toEqual([])
    expect(provider.hasPty('ssh:conn-1@@pty-1')).toBe(true)
  })

  it('keeps a preexisting live row when data arrives during its inventory request', async () => {
    const { mux, notify } = createMux()
    const pendingList = deferred<unknown[]>()
    const process = {
      id: 'pty-1',
      cwd: '/repo',
      title: 'shell',
      incarnationId: 'incarnation-1'
    }
    mux.request.mockResolvedValueOnce([process]).mockReturnValueOnce(pendingList.promise)
    const provider = new SshPtyProvider('conn-1', mux as never)
    await provider.listProcesses()

    const listing = provider.listProcesses()
    notify('pty.data', { id: 'pty-1', data: 'busy', incarnationId: 'incarnation-1' })
    pendingList.resolve([process])

    await expect(listing).resolves.toEqual([
      expect.objectContaining({ id: 'ssh:conn-1@@pty-1', incarnationId: 'incarnation-1' })
    ])
    expect(provider.hasPty('ssh:conn-1@@pty-1')).toBe(true)
  })

  it('reconciles an authoritative empty inventory without a concurrent change', async () => {
    const { mux } = createMux()
    mux.request
      .mockResolvedValueOnce([{ id: 'pty-1', cwd: '/repo', title: 'shell' }])
      .mockResolvedValueOnce([])
    const provider = new SshPtyProvider('conn-1', mux as never)

    await provider.listProcesses()
    await provider.listProcesses()

    expect(provider.hasPty('ssh:conn-1@@pty-1')).toBe(false)
  })

  it('rejects a superseded list response after a newer inventory commits', async () => {
    const { mux } = createMux()
    const staleList = deferred<unknown[]>()
    mux.request
      .mockReturnValueOnce(staleList.promise)
      .mockResolvedValueOnce([{ id: 'pty-new', cwd: '/new', title: 'new' }])
    const provider = new SshPtyProvider('conn-1', mux as never)

    const stale = provider.listProcesses()
    await provider.listProcesses()
    staleList.resolve([{ id: 'pty-old', cwd: '/old', title: 'old' }])

    await expect(stale).rejects.toThrow('ssh_pty_process_inventory_unavailable')
    expect(provider.hasPty('ssh:conn-1@@pty-new')).toBe(true)
    expect(provider.hasPty('ssh:conn-1@@pty-old')).toBe(false)
  })

  it('rejects same-incarnation authority metadata disappearance', async () => {
    const { mux } = createMux()
    mux.request
      .mockResolvedValueOnce([
        {
          id: 'pty-1',
          cwd: '/repo',
          title: 'shell',
          incarnationId: 'incarnation-1',
          terminalSessionAuthorityAccess: authorityAccess
        }
      ])
      .mockResolvedValueOnce([
        { id: 'pty-1', cwd: '/repo', title: 'shell', incarnationId: 'incarnation-1' }
      ])
    const provider = new SshPtyProvider('conn-1', mux as never)
    await provider.listProcesses()

    await expect(provider.listProcesses()).rejects.toThrow(
      'ssh_terminal_authority_access_downgrade'
    )
    expect(provider.getPtyMutationRouteToken('ssh:conn-1@@pty-1')).not.toBeNull()
  })
})
