import { createHash } from 'node:crypto'
import { describe, expect, it, vi } from 'vitest'
import { OrcaRuntimeService } from './orca-runtime'

const PANE_KEY = '11111111-1111-4111-8111-111111111111:22222222-2222-4222-8222-222222222222'
const TOKEN = 'launch-secret'
const TOKEN_HASH = createHash('sha256').update(TOKEN).digest('hex')

type TerminalAuthorityResolver = {
  getOrchestrationDispatchAuthority: (terminalHandle: string) => unknown
}

function createRuntime(
  hostScope:
    | { kind: 'local'; hostId: 'local' }
    | { kind: 'wsl'; hostId: 'local'; distro: string }
    | { kind: 'ssh'; targetId: string }
) {
  const runtime = new OrcaRuntimeService(null, undefined, {
    attestAgentHookCompatibilityAuthority: ({ paneKey, launchTokenHash, connectionId }) =>
      paneKey === PANE_KEY &&
      launchTokenHash === TOKEN_HASH &&
      connectionId === (hostScope.kind === 'ssh' ? hostScope.targetId : null)
        ? { paneKey, source: 'hydrated_commitment' }
        : null
  })
  const resolveTerminal = vi.fn(() => ({
    runtimeId: 'runtime-1',
    terminalHandle: 'term-1',
    ptyId: 'pty-1',
    processIncarnation: 'incarnation-1',
    paneKey: PANE_KEY,
    launchTokenHash: TOKEN_HASH,
    hostScope
  }))
  ;(runtime as unknown as TerminalAuthorityResolver).getOrchestrationDispatchAuthority =
    resolveTerminal
  return runtime
}

describe('orchestration compatibility runtime authority', () => {
  it('returns only attested local identity and its token hash', () => {
    const runtime = createRuntime({ kind: 'local', hostId: 'local' })

    const authority = runtime.verifyOrchestrationCompatibilityCaller({
      terminalHandle: 'term-1',
      paneKey: PANE_KEY,
      launchToken: TOKEN
    })

    expect(authority).toEqual({
      hostScope: { kind: 'local', hostId: 'local' },
      paneKey: PANE_KEY,
      terminalHandle: 'term-1',
      processIncarnation: 'incarnation-1',
      launchTokenHash: TOKEN_HASH
    })
    expect(JSON.stringify(authority)).not.toContain(TOKEN)
    expect(
      runtime.verifyOrchestrationCompatibilityCaller({
        terminalHandle: 'term-1',
        paneKey: PANE_KEY,
        launchToken: 'wrong'
      })
    ).toBeNull()
  })

  it('keeps local and WSL authority stable across app runtime generations', () => {
    const firstLocal = createRuntime({ kind: 'local', hostId: 'local' })
    const secondLocal = createRuntime({ kind: 'local', hostId: 'local' })
    const wsl = createRuntime({ kind: 'wsl', hostId: 'local', distro: 'Ubuntu' })
    const localEvidence = {
      terminalHandle: 'term-1',
      paneKey: PANE_KEY,
      launchToken: TOKEN
    }
    const wslEvidence = {
      ...localEvidence,
      host: { kind: 'wsl', hostId: 'local', distro: 'Ubuntu' }
    } as const

    expect(firstLocal.verifyOrchestrationCompatibilityCaller(localEvidence)?.hostScope).toEqual(
      secondLocal.verifyOrchestrationCompatibilityCaller(localEvidence)?.hostScope
    )
    expect(wsl.verifyOrchestrationCompatibilityCaller(wslEvidence)?.hostScope).toEqual({
      kind: 'wsl',
      hostId: 'local',
      distro: 'Ubuntu'
    })
    expect(wsl.verifyOrchestrationCompatibilityCaller(localEvidence)).toBeNull()
    expect(
      wsl.verifyOrchestrationCompatibilityCaller({
        ...wslEvidence,
        host: { kind: 'wsl', hostId: 'runtime-before-restart', distro: 'Ubuntu' }
      })
    ).toBeNull()
  })

  it('requires a live exact terminal even when the hook proof is hydrated', () => {
    const runtime = createRuntime({ kind: 'local', hostId: 'local' })
    ;(runtime as unknown as TerminalAuthorityResolver).getOrchestrationDispatchAuthority = () =>
      null

    expect(
      runtime.verifyOrchestrationCompatibilityCaller({
        terminalHandle: 'term-1',
        paneKey: PANE_KEY,
        launchToken: TOKEN
      })
    ).toBeNull()
  })

  it('accepts only a live runtime-issued SSH attachment', () => {
    const runtime = createRuntime({ kind: 'ssh', targetId: 'saved-target' })
    const host = runtime.registerOrchestrationCompatibilitySshAttachment(
      'saved-target',
      'connection-1'
    )
    const evidence = {
      terminalHandle: 'term-1',
      paneKey: PANE_KEY,
      launchToken: TOKEN,
      host
    } as const

    expect(runtime.verifyOrchestrationCompatibilityCaller(evidence)).not.toBeNull()
    expect(
      runtime.verifyOrchestrationCompatibilityCaller({
        ...evidence,
        host: { ...host, attachmentId: 'caller-chosen' }
      })
    ).toBeNull()

    runtime.releaseOrchestrationCompatibilitySshAttachment(host.attachmentId)

    expect(runtime.verifyOrchestrationCompatibilityCaller(evidence)).toBeNull()
  })
})
