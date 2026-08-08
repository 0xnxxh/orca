import { describe, expect, it, vi } from 'vitest'
import type { TerminalSessionAuthorityPtyAccess } from '../../shared/terminal-session-authority-pty-access'
import { sameTerminalSessionAuthorityPtyAccess } from '../../shared/terminal-session-authority-pty-access'
import type { TerminalSessionAuthorityPtyOwner } from '../session-authority/terminal-session-authority-pty-owner'
import type { SubprocessHandle } from './session'
import { TERMINAL_HOST_AUTHORITY_OUTPUT_MAX_BYTES } from './terminal-host-authority-output-buffer'
import { TerminalHost } from './terminal-host'
import type { TerminalAuthorityPolicyConsumerConnection } from '../session-authority/terminal-session-authority-policy-consumers'

type TestSubprocess = SubprocessHandle & {
  emitData(data: string): void
  emitExit(code: number): void
}

const POLICY_CONSUMER = Object.freeze({
  identity: Object.freeze({
    consumerId: 'app-profile:host-test',
    consumerIncarnationId: 'app-process:host-test'
  }),
  activate: async () => {},
  ensureNamespace: async () => {},
  assertInstalled: () => {},
  acknowledge: async (ack) => ack.sequence,
  retire: async () => 0,
  isInstalled: () => true,
  disconnect: () => {}
}) satisfies TerminalAuthorityPolicyConsumerConnection

function createSubprocess(events: string[]): TestSubprocess {
  let onData: ((data: string) => void) | null = null
  let onExit: ((code: number) => void) | null = null
  return {
    pid: 99_999,
    getForegroundProcess: () => null,
    write: vi.fn(),
    resize: vi.fn(),
    clear: vi.fn(),
    pause: vi.fn(() => events.push('pause')),
    resume: vi.fn(() => events.push('resume')),
    kill: vi.fn(() => onExit?.(0)),
    forceKill: vi.fn(() => onExit?.(137)),
    signal: vi.fn(),
    onData: (callback) => {
      onData = callback
    },
    onExit: (callback) => {
      onExit = callback
    },
    dispose: vi.fn(),
    emitData: (data) => onData?.(data),
    emitExit: (code) => onExit?.(code)
  }
}

function access(ptyIncarnationId: string): TerminalSessionAuthorityPtyAccess {
  return {
    namespace: { authorityHostId: 'host-a', namespaceId: 'namespace-a' },
    pane: { paneKey: 'pane-a', paneGenerationId: 'renderer:3' },
    binding: {
      ownerIncarnationId: 'owner-a',
      physicalPtyId: 'pty-a',
      ptyIncarnationId
    }
  }
}

function authorityFixture(events: string[], onCommit?: (subprocess: TestSubprocess) => void) {
  const subprocess = createSubprocess(events)
  let currentAccess: TerminalSessionAuthorityPtyAccess | null = null
  const owner = {
    prepareSpawn: vi.fn(async () => {
      events.push('durable-prepare')
      return { kind: 'spawn', prepared: { kind: 'spawn' } }
    }),
    commitSpawn: vi.fn(async (_prepared, incarnationId: string) => {
      events.push('durable-commit')
      onCommit?.(subprocess)
      currentAccess = access(incarnationId)
      return currentAccess
    }),
    cancelSpawn: vi.fn(async () => events.push('cancel-prepare')),
    accessFor: vi.fn((id: string) => (id === 'pty-a' ? currentAccess : null)),
    admits: vi.fn(
      (id: string, candidate: TerminalSessionAuthorityPtyAccess) =>
        id === 'pty-a' && sameTerminalSessionAuthorityPtyAccess(currentAccess, candidate)
    ),
    recordExit: vi.fn(async () => {
      currentAccess = null
    }),
    policyConsumerTransportInstalled: vi.fn(() => true),
    recordSemanticOutcome: vi.fn(
      async (_id: string, candidate: TerminalSessionAuthorityPtyAccess) =>
        sameTerminalSessionAuthorityPtyAccess(currentAccess, candidate)
    ),
    close: vi.fn(async (_id: string, candidate: TerminalSessionAuthorityPtyAccess) => {
      if (!sameTerminalSessionAuthorityPtyAccess(currentAccess, candidate)) {
        return false
      }
      currentAccess = null
      return true
    }),
    adopt: vi.fn()
  } as unknown as TerminalSessionAuthorityPtyOwner
  return { owner, subprocess }
}

function createOptions(publishAuthorityExit = vi.fn(async () => undefined)) {
  return {
    sessionId: 'pty-a',
    cols: 80,
    rows: 24,
    worktreeId: 'repo::/srv/repo',
    paneKey: 'pane-a',
    paneGeneration: 3,
    terminalSessionAuthorityVersion: 1,
    terminalSessionAuthorityOperationId: 'spawn-operation-a',
    terminalSessionAuthorityNegotiated: true as const,
    terminalSessionAuthorityPolicyConsumer: POLICY_CONSUMER,
    streamClient: {
      onIncarnation: vi.fn(),
      onData: vi.fn(),
      onExit: vi.fn(),
      publishAuthorityExit
    }
  }
}

describe('TerminalHost authority session transaction', () => {
  it('commits and installs the outcome route before releasing bounded early output', async () => {
    const events: string[] = []
    const fixture = authorityFixture(events, (subprocess) => subprocess.emitData('boot\n'))
    const options = createOptions()
    options.streamClient.onData.mockImplementation(() => events.push('publish-data'))
    const host = new TerminalHost({
      spawnSubprocess: () => {
        events.push('native-spawn')
        return fixture.subprocess
      },
      terminalSessionAuthority: {
        ptyOwner: fixture.owner
      }
    })

    const result = await host.createOrAttach(options)

    expect(events).toEqual([
      'durable-prepare',
      'native-spawn',
      'pause',
      'durable-commit',
      'publish-data',
      'resume'
    ])
    expect(result.terminalSessionAuthorityAccess).toEqual(access(result.incarnationId))
    expect(options.streamClient.onData).toHaveBeenCalledWith('boot\n')
    expect(host.listSessions()[0]?.terminalSessionAuthorityAccess).toEqual(
      result.terminalSessionAuthorityAccess
    )

    fixture.subprocess.emitExit(17)
    await vi.waitFor(() => expect(fixture.owner.recordExit).toHaveBeenCalled())
    expect(options.streamClient.onExit).not.toHaveBeenCalled()
    expect(host.listSessions()).toEqual([])
    await host.dispose()
  })

  it('rejects legacy and stale mutations once full authority is installed', async () => {
    const events: string[] = []
    const fixture = authorityFixture(events)
    const options = createOptions()
    const host = new TerminalHost({
      spawnSubprocess: () => fixture.subprocess,
      terminalSessionAuthority: {
        ptyOwner: fixture.owner
      }
    })
    const result = await host.createOrAttach(options)
    const authorityAccess = result.terminalSessionAuthorityAccess!

    expect(host.writeExact('pty-a', result.incarnationId, 'legacy')).toBe(false)
    expect(() => host.write('pty-a', 'legacy')).toThrow('Session not found')
    expect(host.writeAuthorityExact('pty-a', authorityAccess, 'current')).toBe(true)
    expect(host.writeAuthorityExact('pty-a', access('stale-incarnation'), 'stale')).toBe(false)
    expect(fixture.subprocess.write).toHaveBeenCalledWith('current')
    expect(fixture.subprocess.write).not.toHaveBeenCalledWith('legacy')
    expect(fixture.subprocess.write).not.toHaveBeenCalledWith('stale')

    await expect(host.killAuthorityExact('pty-a', authorityAccess, POLICY_CONSUMER)).resolves.toBe(
      true
    )
    await vi.waitFor(() => expect(host.listSessions()).toEqual([]))
    await host.dispose()
  })

  it('records a semantic fact only against its captured full binding', async () => {
    const events: string[] = []
    const fixture = authorityFixture(events)
    const host = new TerminalHost({
      spawnSubprocess: () => fixture.subprocess,
      terminalSessionAuthority: {
        ptyOwner: fixture.owner
      }
    })
    const result = await host.createOrAttach(createOptions())
    const current = result.terminalSessionAuthorityAccess!
    const stale = {
      ...current,
      pane: { ...current.pane, paneGenerationId: 'renderer:stale' }
    }

    await expect(host.recordSemanticOutcomeExact('pty-a', current, { kind: 'bell' })).resolves.toBe(
      true
    )
    await expect(host.recordSemanticOutcomeExact('pty-a', stale, { kind: 'bell' })).resolves.toBe(
      false
    )
    expect(fixture.owner.recordSemanticOutcome).toHaveBeenCalledOnce()
    expect(fixture.owner.recordSemanticOutcome).toHaveBeenCalledWith('pty-a', current, {
      kind: 'bell'
    })
    await host.dispose()
  })

  it('fails closed when an alive session has no captured authority binding', async () => {
    const subprocess = createSubprocess([])
    const onFailure = vi.fn()
    const host = new TerminalHost({
      spawnSubprocess: () => subprocess,
      onTerminalSessionAuthorityFailure: onFailure
    })
    const options = {
      sessionId: 'pty-a',
      cols: 80,
      rows: 24,
      streamClient: {
        onIncarnation: vi.fn(),
        onData: vi.fn(),
        onExit: vi.fn()
      }
    }
    const result = await host.createOrAttach(options)

    await expect(
      host.recordSemanticOutcomeExact('pty-a', access(result.incarnationId), { kind: 'bell' })
    ).rejects.toThrow('terminal_session_authority_semantic_access_missing')
    expect(onFailure).toHaveBeenCalledOnce()
    await expect(host.dispose()).rejects.toThrow(
      'terminal_session_authority_semantic_access_missing'
    )
  })

  it('rejects authority metadata before physical spawn when hello admission is absent', async () => {
    const events: string[] = []
    const fixture = authorityFixture(events)
    const spawnSubprocess = vi.fn(() => fixture.subprocess)
    const host = new TerminalHost({
      spawnSubprocess,
      terminalSessionAuthority: {
        ptyOwner: fixture.owner
      }
    })
    const { terminalSessionAuthorityNegotiated: _admission, ...unnegotiated } = createOptions()

    await expect(host.createOrAttach(unnegotiated)).rejects.toThrow(
      'terminal_session_authority_unavailable'
    )
    expect(fixture.owner.prepareSpawn).not.toHaveBeenCalled()
    expect(spawnSubprocess).not.toHaveBeenCalled()
    await host.dispose()
  })

  it('rejects admitted metadata before physical spawn when authority infrastructure is absent', async () => {
    const spawnSubprocess = vi.fn(() => createSubprocess([]))
    const host = new TerminalHost({ spawnSubprocess })

    await expect(host.createOrAttach(createOptions())).rejects.toThrow(
      'terminal_session_authority_unavailable'
    )
    expect(spawnSubprocess).not.toHaveBeenCalled()
    await host.dispose()
  })

  it('publishes an exit that races durable commit only after the session is addressable', async () => {
    const events: string[] = []
    const fixture = authorityFixture(events, (subprocess) => {
      subprocess.emitData('last output\n')
      subprocess.emitExit(23)
    })
    const options = createOptions()
    const host = new TerminalHost({
      spawnSubprocess: () => fixture.subprocess,
      terminalSessionAuthority: {
        ptyOwner: fixture.owner
      }
    })

    await host.createOrAttach(options)

    await vi.waitFor(() => expect(fixture.owner.recordExit).toHaveBeenCalled())
    expect(options.streamClient.onData).toHaveBeenCalledWith('last output\n')
    expect(options.streamClient.onExit).not.toHaveBeenCalled()
    expect(fixture.subprocess.resume).not.toHaveBeenCalled()
    expect(host.listSessions()).toEqual([])
    await host.dispose()
  })

  it('cancels the durable allocation only when native spawn never dispatches', async () => {
    const events: string[] = []
    const fixture = authorityFixture(events)
    const spawnFailure = new Error('native spawn failed')
    const onFailure = vi.fn()
    const host = new TerminalHost({
      spawnSubprocess: () => {
        throw spawnFailure
      },
      terminalSessionAuthority: {
        ptyOwner: fixture.owner
      },
      onTerminalSessionAuthorityFailure: onFailure
    })

    await expect(host.createOrAttach(createOptions())).rejects.toThrow(spawnFailure)
    expect(fixture.owner.cancelSpawn).toHaveBeenCalledOnce()
    expect(onFailure).not.toHaveBeenCalled()
    await host.dispose()
  })

  it('fences creation instead of releasing an over-capacity pre-commit stream', async () => {
    const events: string[] = []
    const fixture = authorityFixture(events, (subprocess) =>
      subprocess.emitData('x'.repeat(TERMINAL_HOST_AUTHORITY_OUTPUT_MAX_BYTES + 1))
    )
    const onFailure = vi.fn()
    const host = new TerminalHost({
      spawnSubprocess: () => fixture.subprocess,
      terminalSessionAuthority: {
        ptyOwner: fixture.owner
      },
      onTerminalSessionAuthorityFailure: onFailure
    })

    await expect(host.createOrAttach(createOptions())).rejects.toThrow(
      'terminal_session_authority_early_output_capacity_exceeded'
    )
    expect(fixture.owner.cancelSpawn).not.toHaveBeenCalled()
    expect(fixture.subprocess.resume).not.toHaveBeenCalled()
    expect(onFailure).toHaveBeenCalledOnce()
    await expect(host.dispose()).rejects.toThrow(
      'terminal_session_authority_early_output_capacity_exceeded'
    )
  })
})
