// Why: every remote CLI command used to open two full WebSocket connections — one for the compat
// preflight, one for the real call — and each connection pays a complete E2EE authentication.
// sendRemoteRuntimeRequest constructs exactly one WebSocket per call, so counting calls counts sockets.
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import {
  MIN_COMPATIBLE_RUNTIME_SERVER_VERSION,
  RUNTIME_PROTOCOL_VERSION
} from '../../shared/protocol-version'
import { encodePairingOffer, PAIRING_OFFER_VERSION } from '../../shared/pairing'
import type * as RemoteRuntimeClientModule from '../../shared/remote-runtime-client'
import type { RuntimeEnvironmentStore } from '../../shared/runtime-environments'
import { RuntimeClient } from './client'

const mocks = vi.hoisted(() => ({
  sendRemoteRuntimeRequest: vi.fn(),
  runtimeId: { current: 'runtime-1' }
}))

vi.mock('../../shared/remote-runtime-client', async (importOriginal) => ({
  ...(await importOriginal<RemoteRuntimeClientModule>()),
  sendRemoteRuntimeRequest: mocks.sendRemoteRuntimeRequest
}))

const ENVIRONMENT_NAME = 'dev-box'

function writeEnvironmentStore(userDataPath: string, runtimeCompat?: unknown): void {
  const store = {
    version: 1,
    environments: [
      {
        id: 'env-1',
        name: ENVIRONMENT_NAME,
        createdAt: 1,
        updatedAt: 1,
        lastUsedAt: null,
        runtimeId: null,
        ...(runtimeCompat ? { runtimeCompat } : {}),
        endpoints: [
          {
            id: 'ws-env-1',
            kind: 'websocket',
            label: 'WebSocket',
            endpoint: 'ws://127.0.0.1:65000/',
            deviceToken: 'device-token',
            publicKeyB64: 'cHVibGljLWtleQ=='
          }
        ],
        preferredEndpointId: 'ws-env-1'
      }
    ]
  }
  writeFileSync(join(userDataPath, 'orca-environments.json'), JSON.stringify(store), 'utf8')
}

function readStoredCompat(userDataPath: string): unknown {
  const store = JSON.parse(
    readFileSync(join(userDataPath, 'orca-environments.json'), 'utf8')
  ) as RuntimeEnvironmentStore
  return store.environments[0]?.runtimeCompat ?? null
}

function verifiedCompat(runtimeId = 'runtime-1'): Record<string, unknown> {
  return {
    runtimeId,
    appVersion: '1.4.165',
    clientProtocolVersion: RUNTIME_PROTOCOL_VERSION,
    minCompatibleServerProtocolVersion: MIN_COMPATIBLE_RUNTIME_SERVER_VERSION
  }
}

describe('remote CLI compat preflight', () => {
  let userDataPath = ''

  beforeEach(() => {
    userDataPath = mkdtempSync(join(tmpdir(), 'orca-remote-compat-'))
    mocks.runtimeId.current = 'runtime-1'
    mocks.sendRemoteRuntimeRequest.mockReset()
    mocks.sendRemoteRuntimeRequest.mockImplementation(
      async (_pairing: unknown, method: string) => ({
        id: 'rpc-1',
        ok: true,
        result:
          method === 'status.get'
            ? {
                runtimeId: mocks.runtimeId.current,
                appVersion: '1.4.165',
                graphStatus: 'ready',
                runtimeProtocolVersion: RUNTIME_PROTOCOL_VERSION,
                minCompatibleRuntimeClientVersion: MIN_COMPATIBLE_RUNTIME_SERVER_VERSION
              }
            : { terminals: [] },
        _meta: { runtimeId: mocks.runtimeId.current }
      })
    )
  })

  function client(): RuntimeClient {
    return new RuntimeClient(userDataPath, 1_000, null, ENVIRONMENT_NAME)
  }

  it('opens two connections when the environment has no verified runtime', async () => {
    writeEnvironmentStore(userDataPath)

    await client().call('terminal.list')

    expect(mocks.sendRemoteRuntimeRequest).toHaveBeenCalledTimes(2)
    expect(mocks.sendRemoteRuntimeRequest.mock.calls.map(([, method]) => method)).toEqual([
      'status.get',
      'terminal.list'
    ])
    expect(readStoredCompat(userDataPath)).toEqual(verifiedCompat())
  })

  it('opens one connection once the runtime is recorded as compatible', async () => {
    writeEnvironmentStore(userDataPath, verifiedCompat())

    await client().call('terminal.list')

    expect(mocks.sendRemoteRuntimeRequest).toHaveBeenCalledTimes(1)
    expect(mocks.sendRemoteRuntimeRequest.mock.calls.map(([, method]) => method)).toEqual([
      'terminal.list'
    ])
  })

  it('re-runs the preflight after the runtime restarts under a trusted record', async () => {
    writeEnvironmentStore(userDataPath, verifiedCompat())
    mocks.runtimeId.current = 'runtime-2'

    await client().call('terminal.list')
    expect(readStoredCompat(userDataPath)).toBeNull()

    mocks.sendRemoteRuntimeRequest.mockClear()
    await client().call('terminal.list')

    expect(mocks.sendRemoteRuntimeRequest.mock.calls.map(([, method]) => method)).toEqual([
      'status.get',
      'terminal.list'
    ])
  })

  it('re-runs the preflight when the record predates this client protocol version', async () => {
    writeEnvironmentStore(userDataPath, {
      ...verifiedCompat(),
      clientProtocolVersion: RUNTIME_PROTOCOL_VERSION - 1
    })

    await client().call('terminal.list')

    expect(mocks.sendRemoteRuntimeRequest.mock.calls.map(([, method]) => method)).toEqual([
      'status.get',
      'terminal.list'
    ])
  })

  it('keeps the preflight for a raw pairing code, which has no record to trust', async () => {
    const pairingCode = encodePairingOffer({
      v: PAIRING_OFFER_VERSION,
      endpoint: 'ws://127.0.0.1:65000/',
      deviceToken: 'device-token',
      publicKeyB64: 'cHVibGljLWtleQ=='
    })

    await new RuntimeClient(userDataPath, 1_000, pairingCode, null).call('terminal.list')

    expect(mocks.sendRemoteRuntimeRequest.mock.calls.map(([, method]) => method)).toEqual([
      'status.get',
      'terminal.list'
    ])
  })
})
