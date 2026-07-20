import { createElement } from 'react'
import { act, create, type ReactTestRenderer } from 'react-test-renderer'
import { describe, expect, it, vi } from 'vitest'
import type { RpcClient } from './rpc-client'
import { useHostStatusGates, type HostStatusGates } from './host-status-gates'

function suppressReactTestRendererDeprecationWarning(): () => void {
  const originalConsoleError = console.error
  const spy = vi.spyOn(console, 'error').mockImplementation((...args) => {
    if (typeof args[0] === 'string' && args[0].includes('react-test-renderer is deprecated')) {
      return
    }
    originalConsoleError(...args)
  })
  return () => spy.mockRestore()
}

describe('useHostStatusGates', () => {
  it('clears every prior-host gate and ignores its late response while the client is replaced', async () => {
    let resolveStatus: ((response: unknown) => void) | null = null
    const pendingStatus = new Promise((resolve) => {
      resolveStatus = resolve
    })
    const sendRequest = vi.fn().mockReturnValue(pendingStatus)
    const client = { sendRequest } as unknown as RpcClient
    let gates: HostStatusGates | null = null
    let renderer: ReactTestRenderer | null = null

    function Probe({ hostId }: { hostId: string }): null {
      gates = useHostStatusGates({ hostId, client, connState: 'connected' })
      return null
    }

    const restore = suppressReactTestRendererDeprecationWarning()
    try {
      await act(async () => {
        renderer = create(createElement(Probe, { hostId: 'host-1' }))
      })

      await act(async () => {
        renderer?.update(createElement(Probe, { hostId: 'host-2' }))
      })
      expect(gates).toMatchObject({
        hostCapabilities: [],
        floatingWorkspaceEnabled: false,
        compatVerdict: { kind: 'ok' }
      })

      await act(async () => {
        resolveStatus?.({
          ok: true,
          result: {
            capabilities: ['browser.screencast.v1'],
            floatingWorkspaceEnabled: true
          }
        })
        await pendingStatus
      })
      expect(gates).toMatchObject({
        hostCapabilities: [],
        floatingWorkspaceEnabled: false,
        compatVerdict: { kind: 'ok' }
      })
      expect(sendRequest).toHaveBeenCalledOnce()
    } finally {
      restore()
      renderer?.unmount()
    }
  })

  it('loads gates from the connected host', async () => {
    const sendRequest = vi.fn().mockResolvedValue({
      ok: true,
      result: {
        capabilities: ['browser.screencast.v1'],
        floatingWorkspaceEnabled: true
      }
    })
    const client = { sendRequest } as unknown as RpcClient
    let gates: HostStatusGates | null = null
    let renderer: ReactTestRenderer | null = null

    function Probe({ hostId }: { hostId: string }): null {
      gates = useHostStatusGates({ hostId, client, connState: 'connected' })
      return null
    }

    const restore = suppressReactTestRendererDeprecationWarning()
    try {
      await act(async () => {
        renderer = create(createElement(Probe, { hostId: 'host-1' }))
        await Promise.resolve()
      })
      expect(gates).toMatchObject({
        hostCapabilities: ['browser.screencast.v1'],
        floatingWorkspaceEnabled: true
      })

      expect(sendRequest).toHaveBeenCalledOnce()
    } finally {
      restore()
      renderer?.unmount()
    }
  })
})
