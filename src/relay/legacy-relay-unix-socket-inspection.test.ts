import { describe, expect, it } from 'vitest'
import {
  proveSoleLegacyRelayBroker,
  type LegacyRelayStatusSample
} from './legacy-relay-broker-connection-proof'
import { inspectLegacyUnixSocket } from './legacy-relay-unix-socket-inspection'
import { parseLinuxProcNetUnix, parseLsofUnixFields } from './legacy-relay-unix-socket-records'

const socketPath = '/var/run/orca relay.sock'
const endpointIdentity = Object.freeze({
  kind: 'unix-socket' as const,
  device: '18',
  inode: '700',
  changedAtNs: '900'
})

function procNetUnix(acceptedInodes = ['701']): string {
  return [
    'Num       RefCount Protocol Flags    Type St Inode Path',
    `0001: 00000002 00000000 00010000 0001 01 700 ${socketPath}`,
    ...acceptedInodes.map(
      (inode) => `0002: 00000003 00000000 00000000 0001 03 ${inode} ${socketPath}`
    ),
    '0003: 00000003 00000000 00000000 0001 03 999 /tmp/unrelated.sock'
  ].join('\n')
}

describe('legacy relay Unix socket inspection', () => {
  it('parses procfs paths with spaces without weakening inode identity', () => {
    expect(parseLinuxProcNetUnix(procNetUnix())).toEqual([
      {
        flags: '00010000',
        type: '0001',
        state: '01',
        inode: '700',
        path: socketPath
      },
      {
        flags: '00000000',
        type: '0001',
        state: '03',
        inode: '701',
        path: socketPath
      },
      {
        flags: '00000000',
        type: '0001',
        state: '03',
        inode: '999',
        path: '/tmp/unrelated.sock'
      }
    ])
  })

  it('proves one Linux accepted socket from procfs and the relay fd table', async () => {
    const result = await inspectLegacyUnixSocket(
      { platform: 'linux', socketPath, relayPid: 42 },
      {
        inspectEndpoint: async () => endpointIdentity,
        readTextFile: async () => procNetUnix(),
        listDirectory: async () => ['4', '5', '6'],
        readLink: async (path) =>
          path.endsWith('/4') ? 'socket:[700]' : path.endsWith('/5') ? 'socket:[701]' : 'pipe:[12]'
      }
    )

    expect(result).toEqual({
      method: 'linux-procfs-unix',
      endpointIdentity,
      listenerIdentity: '42:socket:700',
      acceptedServerConnections: 1
    })
  })

  it('fails closed when Linux has a second accepted client', async () => {
    await expect(
      inspectLegacyUnixSocket(
        { platform: 'linux', socketPath, relayPid: 42 },
        {
          inspectEndpoint: async () => endpointIdentity,
          readTextFile: async () => procNetUnix(['701', '702']),
          listDirectory: async () => ['4', '5', '6'],
          readLink: async (path) =>
            path.endsWith('/4')
              ? 'socket:[700]'
              : path.endsWith('/5')
                ? 'socket:[701]'
                : 'socket:[702]'
        }
      )
    ).rejects.toThrow('exactly one accepted Unix client')
  })

  it('parses lsof NUL fields and proves one macOS accepted client', async () => {
    const lsof = [
      'p42',
      'f5u',
      'tunix',
      `n${socketPath}`,
      'TST=LISTEN',
      'f6u',
      'tunix',
      `n${socketPath}->`,
      'TST=CONNECTED'
    ].join('\0')
    expect(parseLsofUnixFields(lsof)).toHaveLength(2)

    await expect(
      inspectLegacyUnixSocket(
        { platform: 'darwin', socketPath, relayPid: 42 },
        { inspectEndpoint: async () => endpointIdentity, runLsof: async () => lsof }
      )
    ).resolves.toEqual({
      method: 'darwin-lsof-unix',
      endpointIdentity,
      listenerIdentity: '42:unix:18:700',
      acceptedServerConnections: 1
    })
  })

  it('requires stable two-sample sole-broker status proof', () => {
    const inspection = {
      method: 'linux-procfs-unix' as const,
      endpointIdentity,
      listenerIdentity: '42:socket:700',
      acceptedServerConnections: 1 as const
    }
    const samples: readonly LegacyRelayStatusSample[] = [
      {
        pid: 42,
        legacyCutover: {
          capabilityVersion: 1,
          configuredGraceMs: 0,
          acknowledged: true,
          brokerConnectionIdentity: 'owner:3:connection:9'
        },
        socket: { path: socketPath, listening: true, clients: 1, acceptedConnections: 7 }
      },
      {
        pid: 42,
        legacyCutover: {
          capabilityVersion: 1,
          configuredGraceMs: 0,
          acknowledged: true,
          brokerConnectionIdentity: 'owner:3:connection:9'
        },
        socket: { path: socketPath, listening: true, clients: 1, acceptedConnections: 7 }
      }
    ]
    expect(
      proveSoleLegacyRelayBroker({
        endpointPath: socketPath,
        relayPid: 42,
        brokerConnectionIdentity: 'owner:3:connection:9',
        samples,
        platformInspection: inspection
      })
    ).toMatchObject({
      brokerClientCount: 1,
      acceptedConnectionCount: 7,
      quiescenceSamples: 2,
      graceConfiguration: { configuredGraceMs: 0, acknowledged: true },
      connectionProof: { acceptedServerConnections: 1 }
    })
    expect(() =>
      proveSoleLegacyRelayBroker({
        endpointPath: socketPath,
        relayPid: 42,
        brokerConnectionIdentity: 'owner:3:connection:9',
        samples: [samples[0], { ...samples[1], socket: { ...samples[1].socket, clients: 2 } }],
        platformInspection: inspection
      })
    ).toThrow('one live broker client')
    expect(() =>
      proveSoleLegacyRelayBroker({
        endpointPath: socketPath,
        relayPid: 42,
        brokerConnectionIdentity: 'owner:3:connection:9',
        samples: [
          samples[0],
          { ...samples[1], socket: { ...samples[1].socket, acceptedConnections: 8 } }
        ],
        platformInspection: inspection
      })
    ).toThrow('during the quiescence proof')
  })
})
