import { describe, expect, it } from 'vitest'
import {
  parsePtyAuthorityExactOperationRequest,
  PTY_CLEAR_BUFFER_AUTHORITY_EXACT_METHOD,
  PTY_DATA_AUTHORITY_EXACT_METHOD,
  PTY_RESIZE_AUTHORITY_EXACT_METHOD,
  PTY_SEND_SIGNAL_AUTHORITY_EXACT_METHOD,
  PTY_SHUTDOWN_AUTHORITY_EXACT_METHOD
} from './terminal-authority-exact-operation-protocol'

const access = {
  namespace: { authorityHostId: 'host-a', namespaceId: 'namespace-a' },
  pane: { paneKey: 'pane-a', paneGenerationId: 'renderer:3' },
  binding: {
    ownerIncarnationId: 'owner-a',
    physicalPtyId: 'pty-1',
    ptyIncarnationId: 'incarnation-a'
  }
}

describe('terminal authority exact-operation protocol', () => {
  it.each([
    [PTY_DATA_AUTHORITY_EXACT_METHOD, { data: 'input' }, { kind: 'data', data: 'input' }],
    [
      PTY_RESIZE_AUTHORITY_EXACT_METHOD,
      { cols: 120, rows: 40 },
      { kind: 'resize', cols: 120, rows: 40 }
    ],
    [
      PTY_SEND_SIGNAL_AUTHORITY_EXACT_METHOD,
      { signal: 'SIGTERM' },
      { kind: 'signal', signal: 'SIGTERM' }
    ],
    [PTY_CLEAR_BUFFER_AUTHORITY_EXACT_METHOD, {}, { kind: 'clear' }],
    [
      PTY_SHUTDOWN_AUTHORITY_EXACT_METHOD,
      { immediate: true, keepHistory: false },
      { kind: 'shutdown', immediate: true, keepHistory: false }
    ]
  ] as const)('parses %s with one complete binding', (method, params, mutation) => {
    expect(
      parsePtyAuthorityExactOperationRequest(method, {
        id: 'pty-1',
        terminalSessionAuthorityAccess: access,
        ...params
      })
    ).toEqual({
      id: 'pty-1',
      terminalSessionAuthorityAccess: access,
      mutation
    })
  })

  it.each([
    { id: 'pty-other' },
    { terminalSessionAuthorityAccess: null },
    { immediate: 1 },
    { keepHistory: undefined }
  ])('rejects a partial or mismatched shutdown request: $id', (override) => {
    expect(() =>
      parsePtyAuthorityExactOperationRequest(PTY_SHUTDOWN_AUTHORITY_EXACT_METHOD, {
        id: 'pty-1',
        terminalSessionAuthorityAccess: access,
        immediate: true,
        keepHistory: false,
        ...override
      })
    ).toThrow()
  })
})
