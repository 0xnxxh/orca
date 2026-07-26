import { beforeEach, expect, it, vi } from 'vitest'
import { TERMINAL_TAB_CLOSE_CALLER_TIMEOUT_MS } from '../../../shared/terminal-tab-close'
import {
  MIN_COMPATIBLE_RUNTIME_CLIENT_VERSION,
  RUNTIME_PROTOCOL_VERSION
} from '../../../shared/protocol-version'
import { callRuntimeRpc } from './runtime-rpc-client'

const runtimeEnvironmentCall = vi.fn()

beforeEach(() => {
  runtimeEnvironmentCall.mockReset().mockImplementation(({ method }: { method: string }) => {
    const result =
      method === 'status.get'
        ? {
            runtimeProtocolVersion: RUNTIME_PROTOCOL_VERSION,
            minCompatibleRuntimeClientVersion: MIN_COMPATIBLE_RUNTIME_CLIENT_VERSION
          }
        : { closed: true }
    return Promise.resolve({
      id: method,
      ok: true,
      result,
      _meta: { runtimeId: 'remote-runtime' }
    })
  })
  vi.stubGlobal('window', {
    api: {
      runtimeEnvironments: {
        call: runtimeEnvironmentCall
      }
    }
  })
})

it('floors remote terminal tab closes at the end-to-end caller budget', async () => {
  await callRuntimeRpc(
    { kind: 'environment', environmentId: 'env-1' },
    'terminal.closeTab',
    { terminal: 'terminal-1' },
    { timeoutMs: 1 }
  )

  expect(runtimeEnvironmentCall).toHaveBeenNthCalledWith(1, {
    selector: 'env-1',
    method: 'status.get',
    params: undefined,
    timeoutMs: TERMINAL_TAB_CLOSE_CALLER_TIMEOUT_MS
  })
  expect(runtimeEnvironmentCall).toHaveBeenNthCalledWith(2, {
    selector: 'env-1',
    method: 'terminal.closeTab',
    params: { terminal: 'terminal-1' },
    timeoutMs: TERMINAL_TAB_CLOSE_CALLER_TIMEOUT_MS
  })
})
