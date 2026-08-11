import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { computeAgentSessionPayloadFingerprint } from '../../../shared/agent-session-mutation-envelope'
import type { AgentSessionRecord } from '../../../shared/agent-session-record'
import type {
  AgentSessionHandoffDirection,
  AgentSessionHandoffMode,
  AgentSessionHandoffRequest,
  AgentSessionHandoffStatus
} from '../../../shared/agent-session-wire'
import { AgentSessionRecordStore } from '../../runtime/agent-session-record-store'
import {
  reserveStoredAgentSessionHandoffOwner,
  setStoredAgentSessionHandoffStage,
  stopStoredAgentSessionOwnerForHandoff
} from '../../runtime/agent-session-handoff-record-transitions'
import { openAgentSessionJournal } from '../agent-session-journal/journal-store'
import { StructuredAgentSessionHandoffCoordinator } from './structured-agent-session-handoff'
import type {
  StructuredAgentSessionHandoffTransport,
  StructuredTuiOwner
} from './structured-agent-session-handoff-types'

const NOW = 1_800_000_000_000
const SESSION = 'session-handoff'
const THREAD = '019fd532-7c11-7a90-b6de-4e1a2c3d5f60'

let root: string
let store: AgentSessionRecordStore
let journal: Awaited<ReturnType<typeof openAgentSessionJournal>>
let coordinator: StructuredAgentSessionHandoffCoordinator
let statuses: AgentSessionHandoffStatus[]
let tuiIdle: boolean
let importFailure: Error | null
let nativeAcquireFailure: Error | null
let launchTui: ReturnType<typeof vi.fn<StructuredAgentSessionHandoffTransport['launchTui']>>
let waitForTuiExit: ReturnType<
  typeof vi.fn<StructuredAgentSessionHandoffTransport['waitForTuiExit']>
>
let reproveTuiOwner: ReturnType<
  typeof vi.fn<StructuredAgentSessionHandoffTransport['reproveTuiOwner']>
>
let stopFailedTuiLaunch: ReturnType<
  typeof vi.fn<NonNullable<StructuredAgentSessionHandoffTransport['stopFailedTuiLaunch']>>
>
let acquireNativeStop: ReturnType<typeof vi.fn<(turnId: string) => Promise<boolean>>>
let acquireNativeCalls: number
let stopRecoveredOwner: ReturnType<
  typeof vi.fn<StructuredAgentSessionHandoffTransport['stopRecoveredOwner']>
>
let operations: number

function operationId(): string {
  operations += 1
  return `${NOW}-${operations.toString(16).padStart(32, '0')}`
}

function request(
  direction: AgentSessionHandoffDirection,
  mode: AgentSessionHandoffMode,
  options: { action?: 'start' | 'cancel-queued' | 'retry'; operationId?: string } = {}
): AgentSessionHandoffRequest {
  const action = options.action ?? 'start'
  const fields = { direction, mode, action }
  return {
    envelope: {
      sessionId: SESSION,
      clientOperationId: options.operationId ?? operationId(),
      expectedRuntimeFence: store.getRecord(SESSION)?.lease.runtimeFence ?? 1,
      payloadFingerprint: computeAgentSessionPayloadFingerprint({
        method: 'agentSession.requestHandoff',
        sessionId: SESSION,
        fields
      })
    },
    ...fields
  }
}

function submit(params: AgentSessionHandoffRequest) {
  return coordinator.request('client-1', params)
}

function process(spawnToken: string, pid: number) {
  return {
    hostId: 'local',
    pid,
    processStartTimeMs: NOW - 1_000,
    spawnToken
  }
}

function link(fence: number, id: string) {
  return {
    linkId: id,
    handle: { provider: 'codex' as const, threadId: THREAD },
    origin: 'resumed' as const,
    mintedAtFence: fence,
    observedAt: NOW
  }
}

async function establishNativeOwner(): Promise<void> {
  const reserved = await store.reserveOwner({
    sessionId: SESSION,
    location: {
      executionHostId: 'local',
      wslDistro: null,
      workspaceId: 'workspace-1',
      workspaceKind: 'git-worktree'
    },
    provider: 'codex',
    accountHome: { variable: 'CODEX_HOME', path: join(root, 'codex-home') },
    runtimeKind: 'native',
    expectedFence: null,
    spawnToken: 'native-initial',
    claimKeyId: 'key-1',
    handoffOperationId: null,
    probe: { outcome: 'reservation-unused' },
    operation: { callerKey: 'test', operationId: operationId(), fingerprint: 'initial' },
    now: NOW
  })
  const fence = reserved.record.lease.runtimeFence
  await store.commitProcessIdentity({
    sessionId: SESSION,
    fence,
    process: process('native-initial', 4100),
    now: NOW
  })
  await store.proveOwner({
    sessionId: SESSION,
    fence,
    link: { ...link(fence, 'initial-link'), origin: 'created' },
    now: NOW
  })
}

function makeTuiOwner(fence: number, spawnToken: string): StructuredTuiOwner {
  return {
    terminal: { handle: 'term-tui', tabId: 'tab-tui', paneKey: 'tab-tui:leaf-tui' },
    process: process(spawnToken, 4200),
    link: link(fence, `tui-link-${fence}`),
    transcriptPath: join(root, 'rollout.jsonl')
  }
}

async function acquireNative(input: {
  sessionId: string
  fence: number
  spawnToken: string
}): Promise<AgentSessionRecord> {
  acquireNativeCalls += 1
  if (nativeAcquireFailure) {
    const error = nativeAcquireFailure
    nativeAcquireFailure = null
    throw error
  }
  await store.commitProcessIdentity({
    sessionId: input.sessionId,
    fence: input.fence,
    process: process(input.spawnToken, 4300 + acquireNativeCalls),
    now: NOW
  })
  return store.proveOwner({
    sessionId: input.sessionId,
    fence: input.fence,
    link: link(input.fence, `native-link-${input.fence}`),
    now: NOW
  })
}

function createCoordinator(): StructuredAgentSessionHandoffCoordinator {
  return new StructuredAgentSessionHandoffCoordinator({
    store,
    claimKeyId: 'key-1',
    transport: {
      hostLabel: 'Test host',
      launchTui,
      reproveTuiOwner,
      recoverTuiOwner: async (record) => {
        const owner = makeTuiOwner(
          record.lease.runtimeFence,
          record.lease.ownerProcess?.spawnToken ?? record.lease.reservedSpawnToken ?? 'recovered'
        )
        return { ...owner, process: record.lease.ownerProcess ?? owner.process }
      },
      stopRecoveredOwner,
      waitForTuiExit,
      tuiStatus: () => (tuiIdle ? 'idle' : 'busy'),
      stopFailedTuiLaunch
    },
    session: () => ({
      journal,
      fence: store.getRecord(SESSION)?.lease.runtimeFence ?? 1
    }),
    suspendNative: vi.fn(async () => undefined),
    acquireNative,
    acquireNativeStop: (_sessionId, turnId) => acquireNativeStop(turnId),
    importTuiHistory: async ({ fence }) => {
      if (importFailure) {
        const error = importFailure
        importFailure = null
        throw error
      }
      await journal.appendItem(
        { provider: 'codex', threadId: THREAD, turnId: 'tui-turn', ordinal: 0 },
        { kind: 'message', role: 'assistant', blocks: [{ type: 'text', text: 'from tui' }] },
        { fence, recovered: true }
      )
    },
    publish: (_sessionId, status) => statuses.push(status),
    schedule: async (_sessionId, task) => task(),
    now: () => NOW
  })
}

async function appendStatus(state: 'running' | 'completed'): Promise<void> {
  await journal.appendItem(
    { provider: 'orca', clientMessageId: 'turn-status' },
    { kind: 'status', text: state, turnLifecycle: { turnId: 'turn-1', state } },
    { fence: store.getRecord(SESSION)?.lease.runtimeFence ?? 1 }
  )
}

async function waitForPhase(phase: AgentSessionHandoffStatus['phase']): Promise<void> {
  await vi.waitFor(() => expect(coordinator.status(SESSION).phase).toBe(phase))
}

async function moveToTui(): Promise<void> {
  expect(await submit(request('to-tui', 'now'))).toMatchObject({ ok: true })
  await vi.waitFor(() => expect(coordinator.status(SESSION)).toMatchObject({ owner: 'tui' }))
}

beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), 'orca-handoff-'))
  operations = 0
  statuses = []
  tuiIdle = true
  importFailure = null
  nativeAcquireFailure = null
  acquireNativeCalls = 0
  stopRecoveredOwner = vi.fn(async () => undefined)
  store = await AgentSessionRecordStore.open({ directory: join(root, 'store'), hostId: 'local' })
  await establishNativeOwner()
  journal = await openAgentSessionJournal({
    identity: {
      sessionId: SESSION,
      workspaceId: 'workspace-1',
      hostId: 'local',
      agent: 'codex',
      providerHandle: { kind: 'codex', threadId: THREAD }
    },
    journalDir: join(root, 'journal')
  })
  launchTui = vi.fn(async ({ fence, spawnToken }) => makeTuiOwner(fence, spawnToken))
  waitForTuiExit = vi.fn(async (owner) => ({ transcriptPath: owner.transcriptPath }))
  reproveTuiOwner = vi.fn(async ({ owner }) => owner)
  stopFailedTuiLaunch = vi.fn(async () => undefined)
  acquireNativeStop = vi.fn(async () => true)
  coordinator = createCoordinator()
})

afterEach(async () => {
  await coordinator.drain()
  await rm(root, { recursive: true, force: true })
})

describe('structured session ownership handoff', () => {
  it('completes native to TUI to native with one owner and journal continuity', async () => {
    await journal.appendItem(
      { provider: 'codex', threadId: THREAD, turnId: 'native-turn', ordinal: 0 },
      { kind: 'message', role: 'user', blocks: [{ type: 'text', text: 'from native' }] },
      { fence: 1 }
    )
    await moveToTui()
    expect(store.getRecord(SESSION)?.lease).toMatchObject({
      runtimeKind: 'tui',
      claimStatus: 'live',
      handoffStage: null
    })

    expect(await submit(request('to-native', 'after-turn'))).toMatchObject({ ok: true })
    await vi.waitFor(() => expect(coordinator.status(SESSION)).toMatchObject({ owner: 'native' }))

    const messages = journal.snapshot().items.filter((item) => item.body.kind === 'message')
    expect(messages).toHaveLength(2)
    expect(new Set(messages.map((item) => item.itemId)).size).toBe(2)
    expect(store.getRecord(SESSION)?.lease).toMatchObject({
      runtimeKind: 'native',
      claimStatus: 'live',
      handoffStage: null
    })
  })

  it('queues a busy native turn, supports cancel, and starts only after idle', async () => {
    await appendStatus('running')
    expect(await submit(request('to-tui', 'after-turn'))).toMatchObject({ ok: true })
    expect(coordinator.status(SESSION).phase).toBe('queued')
    expect(
      await submit(request('to-tui', 'after-turn', { action: 'cancel-queued' }))
    ).toMatchObject({ ok: true })
    await appendStatus('completed')
    await new Promise((resolve) => setTimeout(resolve, 200))
    expect(launchTui).not.toHaveBeenCalled()

    await appendStatus('running')
    expect(await submit(request('to-tui', 'after-turn'))).toMatchObject({ ok: true })
    await appendStatus('completed')
    await vi.waitFor(() => expect(launchTui).toHaveBeenCalledOnce())
  })

  it('durably replays a completed queued cancellation after restart', async () => {
    await appendStatus('running')
    expect(await submit(request('to-tui', 'after-turn'))).toMatchObject({ ok: true })
    const cancellation = request('to-tui', 'after-turn', { action: 'cancel-queued' })
    expect(await submit(cancellation)).toMatchObject({ ok: true, replayed: false })
    await coordinator.drain()

    store = await AgentSessionRecordStore.open({
      directory: join(root, 'store'),
      hostId: 'local'
    })
    coordinator = createCoordinator()

    expect(await submit(cancellation)).toMatchObject({ ok: true, replayed: true })
    expect(launchTui).not.toHaveBeenCalled()
  })

  it('replays a duplicate active handoff without launching a second owner', async () => {
    let finishLaunch!: () => void
    launchTui.mockImplementationOnce(
      ({ fence, spawnToken }) =>
        new Promise((resolve) => {
          finishLaunch = () => resolve(makeTuiOwner(fence, spawnToken))
        })
    )
    const operation = operationId()
    const first = request('to-tui', 'now', { operationId: operation })
    expect(await submit(first)).toMatchObject({ ok: true, replayed: false })
    await vi.waitFor(() => expect(launchTui).toHaveBeenCalledOnce())
    expect(store.getRecord(SESSION)?.lease).toMatchObject({
      runtimeKind: 'tui',
      claimStatus: 'reserved',
      handoffStage: 'new-owner-proving'
    })
    expect(coordinator.status(SESSION).owner).not.toBe('tui')
    expect(await submit(first)).toMatchObject({ ok: true, replayed: true })
    finishLaunch()
    await vi.waitFor(() => expect(coordinator.status(SESSION).owner).toBe('tui'))
    expect(launchTui).toHaveBeenCalledOnce()
  })

  it('replays the same completed handoff operation after the coordinator restarts', async () => {
    const operation = operationId()
    const first = request('to-tui', 'now', { operationId: operation })
    expect(await submit(first)).toMatchObject({ ok: true, replayed: false })
    await vi.waitFor(() => expect(coordinator.status(SESSION).owner).toBe('tui'))
    await coordinator.drain()

    store = await AgentSessionRecordStore.open({
      directory: join(root, 'store'),
      hostId: 'local'
    })
    coordinator = createCoordinator()
    expect(await submit(first)).toMatchObject({ ok: true, replayed: true })
    expect(launchTui).toHaveBeenCalledOnce()
  })

  it('continues a persisted preparing stage after restart instead of stranding it', async () => {
    const operation = operationId()
    const first = request('to-tui', 'now', { operationId: operation })
    await store.admitOperation({
      callerKey: 'client-1',
      operationId: operation,
      fingerprint: computeAgentSessionPayloadFingerprint({
        method: 'agentSession.requestHandoff.operation',
        sessionId: SESSION,
        fields: { direction: 'to-tui' }
      }),
      now: NOW
    })
    await setStoredAgentSessionHandoffStage(store, {
      sessionId: SESSION,
      fence: 1,
      stage: 'preparing',
      handoffOperationId: operation,
      now: NOW
    })
    coordinator = createCoordinator()

    await coordinator.restore(SESSION)

    expect(stopRecoveredOwner).toHaveBeenCalledOnce()
    expect(store.getRecord(SESSION)?.lease).toMatchObject({
      runtimeKind: 'tui',
      claimStatus: 'live',
      handoffStage: null
    })
    await coordinator.drain()
    store = await AgentSessionRecordStore.open({ directory: join(root, 'store'), hostId: 'local' })
    coordinator = createCoordinator()
    expect(await submit(first)).toMatchObject({ ok: true, replayed: true })
    expect(launchTui).toHaveBeenCalledOnce()
  })

  it('finishes a live new-owner-proving stage after restart', async () => {
    const operation = operationId()
    let record = await setStoredAgentSessionHandoffStage(store, {
      sessionId: SESSION,
      fence: 1,
      stage: 'preparing',
      handoffOperationId: operation,
      now: NOW
    })
    record = await stopStoredAgentSessionOwnerForHandoff(store, {
      sessionId: SESSION,
      expectedFence: record.lease.runtimeFence,
      operationId: operation,
      now: NOW
    })
    const spawnToken = 'restarted-tui'
    record = await reserveStoredAgentSessionHandoffOwner(store, {
      sessionId: SESSION,
      expectedFence: record.lease.runtimeFence,
      runtimeKind: 'tui',
      spawnToken,
      operationId: operation,
      claimKeyId: 'key-1',
      now: NOW
    })
    await store.commitProcessIdentity({
      sessionId: SESSION,
      fence: record.lease.runtimeFence,
      process: process(spawnToken, 4400),
      now: NOW
    })
    coordinator = createCoordinator()

    await coordinator.restore(SESSION)

    expect(store.getRecord(SESSION)?.lease).toMatchObject({
      runtimeKind: 'tui',
      claimStatus: 'live',
      handoffStage: null
    })
    expect(coordinator.status(SESSION)).toMatchObject({ owner: 'tui', phase: 'idle' })
  })

  it('rejects cancellation once a queued handoff is no longer pending', async () => {
    expect(
      await submit(request('to-tui', 'after-turn', { action: 'cancel-queued' }))
    ).toMatchObject({ ok: false, refusal: { code: 'agent_session_operation_conflict' } })
    expect(coordinator.status(SESSION)).toMatchObject({ owner: 'native', phase: 'idle' })
  })

  it('durably replays a queued-cancellation refusal as a refusal', async () => {
    const cancellation = request('to-tui', 'after-turn', { action: 'cancel-queued' })
    expect(await submit(cancellation)).toMatchObject({
      ok: false,
      refusal: { code: 'agent_session_operation_conflict' }
    })

    store = await AgentSessionRecordStore.open({ directory: join(root, 'store'), hostId: 'local' })
    coordinator = createCoordinator()

    expect(await submit(cancellation)).toMatchObject({
      ok: false,
      refusal: { code: 'agent_session_operation_conflict' }
    })
    expect(launchTui).not.toHaveBeenCalled()
  })

  it('requires acknowledged cancellation before stopping a native turn', async () => {
    await appendStatus('running')
    expect(await submit(request('to-tui', 'stop-turn'))).toMatchObject({ ok: true })
    await vi.waitFor(() => expect(coordinator.status(SESSION).owner).toBe('tui'))
    expect(acquireNativeStop).toHaveBeenCalledWith('turn-1')
    expect(acquireNativeStop.mock.invocationCallOrder[0]).toBeLessThan(
      launchTui.mock.invocationCallOrder[0] ?? Infinity
    )
  })

  it('queues a busy TUI from host status instead of trusting a stale journal', async () => {
    await moveToTui()
    tuiIdle = false
    expect(await submit(request('to-native', 'after-turn'))).toMatchObject({ ok: true })
    expect(coordinator.status(SESSION).phase).toBe('queued')
    expect(waitForTuiExit).not.toHaveBeenCalled()
    tuiIdle = true
    await vi.waitFor(() => expect(waitForTuiExit).toHaveBeenCalledOnce())
  })

  it('re-proves the current TUI handle before accepting its exit and importing history', async () => {
    await moveToTui()
    const reverse = request('to-native', 'now')
    expect(await submit(reverse)).toMatchObject({ ok: true })
    await vi.waitFor(() => expect(coordinator.status(SESSION).owner).toBe('native'))

    expect(reproveTuiOwner).toHaveBeenCalledOnce()
    expect(reproveTuiOwner.mock.invocationCallOrder[0]).toBeLessThan(
      waitForTuiExit.mock.invocationCallOrder[0] ?? Infinity
    )
  })

  it('does not close or import when the current TUI handle cannot be re-proved', async () => {
    await moveToTui()
    reproveTuiOwner.mockRejectedValueOnce(new Error('provider handle changed'))
    expect(await submit(request('to-native', 'now'))).toMatchObject({ ok: true })
    await waitForPhase('failed')

    expect(waitForTuiExit).not.toHaveBeenCalled()
    expect(store.getRecord(SESSION)?.lease).toMatchObject({
      runtimeKind: 'tui',
      claimStatus: 'live',
      handoffStage: 'preparing'
    })
  })

  it('recovers native ownership when TUI launch or proof fails', async () => {
    launchTui.mockRejectedValueOnce(new Error('resume proof failed'))
    expect(await submit(request('to-tui', 'now'))).toMatchObject({ ok: true })
    await waitForPhase('failed')
    expect(coordinator.status(SESSION)).toMatchObject({
      owner: 'native',
      error: { recoverableOwner: 'native' }
    })
    expect(store.getRecord(SESSION)?.lease).toMatchObject({
      runtimeKind: 'native',
      claimStatus: 'live',
      handoffStage: null
    })
  })

  it('stops a launched but uncommitted TUI before recovering native', async () => {
    launchTui.mockImplementationOnce(async ({ fence, spawnToken }) => ({
      ...makeTuiOwner(fence, spawnToken),
      link: link(fence + 1, 'bad-proof')
    }))
    expect(await submit(request('to-tui', 'now'))).toMatchObject({ ok: true })
    await waitForPhase('failed')
    expect(stopFailedTuiLaunch).toHaveBeenCalledOnce()
    expect(store.getRecord(SESSION)?.lease.runtimeKind).toBe('native')
  })

  it('requires manual recovery when a failed TUI launch cannot be proven stopped', async () => {
    launchTui.mockImplementationOnce(async ({ fence, spawnToken }) => ({
      ...makeTuiOwner(fence, spawnToken),
      link: link(fence + 1, 'bad-proof')
    }))
    stopFailedTuiLaunch.mockRejectedValueOnce(new Error('exit unproved'))
    const failedOperation = operationId()
    expect(await submit(request('to-tui', 'now', { operationId: failedOperation }))).toMatchObject({
      ok: true
    })
    await waitForPhase('failed')

    expect(coordinator.status(SESSION)).toMatchObject({
      owner: 'none',
      stage: 'manual-recovery',
      error: { recoverableOwner: 'none' }
    })
    expect(store.getRecord(SESSION)?.lease.handoffStage).toBe('manual-recovery')
    expect(
      await submit(request('to-tui', 'now', { action: 'retry', operationId: failedOperation }))
    ).toMatchObject({ ok: false, refusal: { code: 'agent_session_operation_conflict' } })
  })

  it('retains the stopped TUI session for retry when native resume fails', async () => {
    await moveToTui()
    importFailure = new Error('history unavailable')
    const retryOperation = operationId()
    expect(
      await submit(request('to-native', 'after-turn', { operationId: retryOperation }))
    ).toMatchObject({ ok: true })
    await waitForPhase('failed')
    expect(coordinator.status(SESSION)).toMatchObject({
      owner: 'tui',
      operationId: retryOperation,
      error: { recoverableOwner: 'tui' }
    })
    expect(store.getRecord(SESSION)?.lease).toMatchObject({
      runtimeKind: 'tui',
      claimStatus: 'released',
      handoffStage: 'old-owner-stopped'
    })

    expect(
      await submit(request('to-native', 'now', { action: 'retry', operationId: retryOperation }))
    ).toMatchObject({ ok: true })
    await vi.waitFor(() => expect(coordinator.status(SESSION).owner).toBe('native'))
    expect(waitForTuiExit).toHaveBeenCalledOnce()
  })

  it('abandons a failed native acquisition and retries from the stopped TUI', async () => {
    await moveToTui()
    nativeAcquireFailure = new Error('native proof unavailable')
    const retryOperation = operationId()
    expect(
      await submit(request('to-native', 'after-turn', { operationId: retryOperation }))
    ).toMatchObject({ ok: true })
    await waitForPhase('failed')

    expect(coordinator.status(SESSION)).toMatchObject({
      owner: 'tui',
      operationId: retryOperation,
      error: { recoverableOwner: 'tui' }
    })
    expect(store.getRecord(SESSION)?.lease).toMatchObject({
      runtimeKind: 'tui',
      claimStatus: 'released',
      handoffStage: 'old-owner-stopped'
    })

    coordinator = createCoordinator()
    expect(coordinator.status(SESSION)).toMatchObject({
      owner: 'tui',
      direction: 'to-native',
      phase: 'failed',
      operationId: retryOperation
    })
    expect(
      await submit(request('to-native', 'now', { action: 'retry', operationId: retryOperation }))
    ).toMatchObject({ ok: true })
    await vi.waitFor(() => expect(coordinator.status(SESSION).owner).toBe('native'))
    expect(waitForTuiExit).toHaveBeenCalledOnce()
    expect(acquireNativeCalls).toBe(2)
  })

  it('publishes every durable stage so concurrent clients see the same transfer', async () => {
    await moveToTui()
    expect(statuses.map((status) => status.stage)).toEqual(
      expect.arrayContaining(['preparing', 'old-owner-stopped', 'new-owner-proving', null])
    )
    expect(statuses.filter((status) => status.phase === 'switching')).toHaveLength(3)
  })
})
