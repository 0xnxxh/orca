import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { DaemonClient } from './client'
import { DaemonPtyAdapter } from './daemon-pty-adapter'
import { PROTOCOL_VERSION } from './types'
import type { TerminalAuthorityAppNamespaceAdmission } from '../session-authority/terminal-authority-app-outcome-host-contract'

const adapters: DaemonPtyAdapter[] = []

afterEach(() => {
  for (const adapter of adapters.splice(0)) {
    adapter.dispose()
  }
  vi.restoreAllMocks()
})

describe('DaemonPtyAdapter authority app admission', () => {
  it('resolves and admits the namespace before authoritative create-or-attach', async () => {
    const order: string[] = []
    const namespace = Object.freeze({
      authorityHostId: 'authority-host:daemon-preflight',
      namespaceId: 'namespace:daemon-preflight'
    })
    const adapter = adapterWithCreateResult(order, namespace)
    const admission: TerminalAuthorityAppNamespaceAdmission & Readonly<{ dispose(): void }> = {
      admitNamespace: vi.fn(async () => {
        order.push('admit')
      }),
      resolveAndAdmitNamespace: vi.fn(async () => {
        order.push('resolve-and-admit')
        return namespace
      }),
      withSourceAdmission: vi.fn(async (locator, operation) => {
        expect(locator).toEqual({ worktreeId: 'repo::workspace' })
        order.push('resolve-and-admit')
        const result = await operation({ namespace, assertCurrent: vi.fn() })
        order.push('release')
        return result
      }),
      dispose: vi.fn()
    }
    adapter.installTerminalAuthorityAppAdmission(admission)

    await adapter.spawn({
      sessionId: 'daemon-preflight-session',
      worktreeId: 'repo::workspace',
      paneKey: 'pane-preflight',
      paneGeneration: 4,
      cols: 80,
      rows: 24
    })

    expect(order).toEqual(['resolve-and-admit', 'create-or-attach', 'release'])
    expect(admission.withSourceAdmission).toHaveBeenCalledOnce()
  })

  it('fails before create-or-attach when the app consumer is unavailable', async () => {
    const order: string[] = []
    const adapter = adapterWithCreateResult(
      order,
      Object.freeze({
        authorityHostId: 'authority-host:daemon-preflight',
        namespaceId: 'namespace:daemon-preflight'
      })
    )

    await expect(
      adapter.spawn({
        sessionId: 'daemon-preflight-missing',
        worktreeId: 'repo::workspace',
        paneKey: 'pane-preflight',
        paneGeneration: 4,
        cols: 80,
        rows: 24
      })
    ).rejects.toThrow('app_consumer_unavailable')
    expect(order).toEqual([])
  })
})

function adapterWithCreateResult(
  order: string[],
  namespace: Readonly<{ authorityHostId: string; namespaceId: string }>
): DaemonPtyAdapter {
  vi.spyOn(DaemonClient.prototype, 'ensureConnected').mockResolvedValue()
  vi.spyOn(DaemonClient.prototype, 'supportsTerminalSessionAuthority').mockReturnValue(true)
  vi.spyOn(DaemonClient.prototype, 'request').mockImplementation(async (type, payload) => {
    if (type !== 'createOrAttach') {
      return {} as never
    }
    order.push('create-or-attach')
    const request = payload as Record<string, unknown>
    return {
      isNew: true,
      incarnationId: 'pty-incarnation:daemon-preflight',
      pid: 42,
      shellState: 'unsupported',
      snapshot: null,
      streamBindingNonce: request.streamBindingNonce,
      terminalSessionAuthorityAccess: {
        namespace,
        pane: {
          paneKey: 'pane-preflight',
          paneGenerationId: 'renderer:4'
        },
        binding: {
          ownerIncarnationId: 'owner-incarnation:daemon-preflight',
          physicalPtyId: request.sessionId,
          ptyIncarnationId: 'pty-incarnation:daemon-preflight'
        }
      }
    } as never
  })
  const adapter = new DaemonPtyAdapter({
    socketPath: join(tmpdir(), 'orca-daemon-preflight.socket'),
    tokenPath: join(tmpdir(), 'orca-daemon-preflight.token'),
    protocolVersion: PROTOCOL_VERSION
  })
  adapters.push(adapter)
  return adapter
}
