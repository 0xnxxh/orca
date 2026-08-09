// The host against a real record store and a real journal, with only the
// provider adapter stubbed — admission, idempotency, and the journal writes are
// exactly the ones that ship.

import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi, type Mock } from 'vitest'
import { agentJournalItemKey } from '../../../shared/agent-session-journal-item-key'
import type { AgentJournalMessageItem } from '../../../shared/agent-session-journal-types'
import type { AgentSessionOwnerProbe } from '../../../shared/agent-session-lease-adjudication'
import { computeAgentSessionPayloadFingerprint } from '../../../shared/agent-session-mutation-envelope'
import type {
  AgentSessionExecutionLocation,
  AgentSessionRecord
} from '../../../shared/agent-session-record'
import type {
  AgentSessionMutationEnvelope,
  AgentSessionSubscribeEvent
} from '../../../shared/agent-session-wire'
import { AgentSessionRecordStore } from '../../runtime/agent-session-record-store'
import { journalDirectoryFor } from '../agent-session-journal/journal-paths'
import { openAgentSessionJournal } from '../agent-session-journal/journal-store'
import type {
  AgentSessionDispatchOutcome,
  StructuredAgentSessionAdapter
} from './structured-agent-session-adapter'
import { attachFingerprintFields } from './structured-agent-session-attach'
import type { AgentSessionAttachParams } from './structured-agent-session-attach'
import { StructuredAgentSessionHost } from './structured-agent-session-host'

const NOW = 1_800_000_000_000
const SESSION = 'session-alpha'
const THREAD = '019fd532-7c11-7a90-b6de-4e1a2c3d5f60'

const LOCATION: AgentSessionExecutionLocation = {
  executionHostId: 'local',
  wslDistro: null,
  workspaceId: 'workspace-1',
  workspaceKind: 'git-worktree'
}

const CALLER = { callerKey: 'client-1' }

let operations = 0

/** `<13-digit ms>-<32 hex>`, the only shape the durable ledger accepts. */
function operationId(): string {
  operations += 1
  return `${NOW}-${operations.toString(16).padStart(32, '0')}`
}

function message(text: string): AgentJournalMessageItem {
  return { kind: 'message', role: 'user', blocks: [{ type: 'text', text }] }
}

function envelope(
  method: string,
  fields: Record<string, unknown>,
  overrides: Partial<AgentSessionMutationEnvelope> = {}
): AgentSessionMutationEnvelope {
  return {
    sessionId: SESSION,
    clientOperationId: operationId(),
    // A mutation names the fence it believes it is writing under; only attach
    // may leave it null.
    expectedRuntimeFence: store.getRecord(SESSION)?.lease.runtimeFence ?? 1,
    payloadFingerprint: computeAgentSessionPayloadFingerprint({
      method,
      sessionId: SESSION,
      fields
    }),
    ...overrides
  }
}

function attachParams(overrides: Partial<AgentSessionAttachParams> = {}): AgentSessionAttachParams {
  const params: AgentSessionAttachParams = {
    envelope: {
      sessionId: SESSION,
      clientOperationId: operationId(),
      expectedRuntimeFence: null,
      payloadFingerprint: '0'.repeat(64)
    },
    location: LOCATION,
    provider: 'codex',
    agent: 'codex',
    accountHome: { variable: 'CODEX_HOME', path: '/home/dev/.codex' },
    runtimeKind: 'native',
    providerHandle: { kind: 'codex', threadId: THREAD },
    ...overrides
  }
  return {
    ...params,
    envelope: {
      ...params.envelope,
      payloadFingerprint: computeAgentSessionPayloadFingerprint({
        method: 'agentSession.attach',
        sessionId: params.envelope.sessionId,
        fields: attachFingerprintFields(params)
      })
    }
  }
}

/** `ensure`: the same transition as create, from a fence the client already holds. */
function ensureParams(fence: number): AgentSessionAttachParams {
  return attachParams({
    envelope: {
      sessionId: SESSION,
      clientOperationId: operationId(),
      expectedRuntimeFence: fence,
      payloadFingerprint: '0'.repeat(64)
    }
  })
}

let root: string
let store: AgentSessionRecordStore
let host: StructuredAgentSessionHost
let dispatch: Mock<StructuredAgentSessionAdapter['dispatch']>
let cancelTurn: Mock<StructuredAgentSessionAdapter['cancelTurn']>
let answerPrompt: Mock<StructuredAgentSessionAdapter['answerPrompt']>
let setOption: Mock<StructuredAgentSessionAdapter['setOption']>
let ordinal = 0

function accepted(): AgentSessionDispatchOutcome {
  ordinal += 1
  return {
    state: 'accepted',
    providerIdentity: { provider: 'codex', threadId: THREAD, turnId: 'turn-1', ordinal }
  }
}

function adapter(): StructuredAgentSessionAdapter {
  return {
    acquire: async ({ fence }) => ({
      process: {
        hostId: 'local',
        pid: 4242,
        processStartTimeMs: 1_700_000_000_000,
        spawnToken: store.getRecord(SESSION)?.lease.reservedSpawnToken ?? 'spawn-a'
      },
      link: {
        linkId: `link-${fence}`,
        handle: { provider: 'codex', threadId: THREAD },
        // A restarted host re-proves the thread it inherited; only the first
        // owner of a session may claim to have created it.
        origin: store.getRecord(SESSION)?.providerHandleChain.length ? 'resumed' : 'created',
        mintedAtFence: fence,
        observedAt: NOW
      }
    }),
    dispatch,
    cancelTurn,
    answerPrompt,
    setOption
  }
}

async function attach(): Promise<AgentSessionRecord | null> {
  const result = await host.attach(CALLER, attachParams())
  expect(result.ok).toBe(true)
  return store.getRecord(SESSION)
}

/** Puts a pending approval in the journal BEFORE attach, which is the only way
 *  1d can stage one: the adapter that would emit it is phase 2's. */
async function seedApproval(optionId = 'allow'): Promise<{ itemId: string; revision: number }> {
  const identity = { provider: 'codex' as const, threadId: THREAD, turnId: 'turn-1', ordinal: 99 }
  const journalDir = journalDirectoryFor(root, { workspaceId: 'workspace-1', sessionId: SESSION })
  const journal = await openAgentSessionJournal({
    identity: {
      sessionId: SESSION,
      workspaceId: 'workspace-1',
      hostId: 'local',
      agent: 'codex',
      providerHandle: { kind: 'codex', threadId: THREAD }
    },
    journalDir
  })
  const appended = await journal.appendItem(
    identity,
    {
      kind: 'approval',
      title: 'Run the command?',
      detail: null,
      options: [{ id: optionId, label: 'Allow' }],
      resolution: { state: 'pending', selectedOptionId: null, resolvedBy: null, resolvedAt: null }
    },
    { fence: 1 }
  )
  return { itemId: appended.itemId, revision: appended.revision }
}

beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), 'orca-wire-host-'))
  operations = 0
  ordinal = 0
  dispatch = vi.fn(async () => accepted())
  cancelTurn = vi.fn(async () => ({ cancelled: true }))
  answerPrompt = vi.fn(async () => undefined)
  setOption = vi.fn(async () => undefined)
  store = await AgentSessionRecordStore.open({ directory: join(root, 'store'), hostId: 'local' })
  host = new StructuredAgentSessionHost({
    store,
    adapter: adapter(),
    journalRoot: root,
    claimKeyId: 'key-1',
    mintSpawnToken: () => 'spawn-a',
    now: () => NOW
  })
})

afterEach(async () => {
  await rm(root, { recursive: true, force: true })
})

describe('attach', () => {
  it('reserves the lease, spawns through the adapter, and opens the journal', async () => {
    const result = await host.attach(CALLER, attachParams())
    expect(result).toMatchObject({ ok: true, replayed: false })
    expect(host.hasSession(SESSION)).toBe(true)
    const record = store.getRecord(SESSION)
    expect(record?.lease.ownerProcess?.pid).toBe(4242)
    expect(record?.lease.handoffStage).toBeNull()
  })

  it('refuses a payload the client fingerprinted wrong', async () => {
    const params = attachParams()
    const result = await host.attach(CALLER, {
      ...params,
      envelope: { ...params.envelope, payloadFingerprint: 'a'.repeat(64) }
    })
    expect(result).toMatchObject({
      ok: false,
      refusal: { code: 'agent_session_operation_conflict' }
    })
  })

  it('refuses a second create against a live session', async () => {
    await attach()
    expect(await host.attach(CALLER, attachParams())).toMatchObject({ ok: false })
  })

  it('replays a retried attach instead of reserving a second owner', async () => {
    const params = attachParams()
    await host.attach(CALLER, params)
    const retry = await host.attach(CALLER, params)
    expect(retry).toMatchObject({ ok: true, replayed: true })
  })
})

describe('send', () => {
  it('writes the submission before dispatching and resolves it accepted', async () => {
    await attach()
    const body = message('add a retry')
    const result = await host.send(CALLER, {
      envelope: envelope('agentSession.send', { body }),
      body
    })
    if (!result.ok) {
      throw new Error(`expected a send, got ${result.refusal.code}`)
    }
    expect(result.value.submission.dispatchState).toBe('accepted')
    expect(dispatch).toHaveBeenCalledTimes(1)
    const page = host.history({ sessionId: SESSION, direction: 'tail' })
    expect(page.ok && page.page.items).toHaveLength(1)
  })

  it('settles a thrown dispatch as unknown, never as a rejection', async () => {
    await attach()
    dispatch.mockRejectedValueOnce(new Error('socket closed'))
    const body = message('add a retry')
    const result = await host.send(CALLER, {
      envelope: envelope('agentSession.send', { body }),
      body
    })
    expect(result).toMatchObject({ ok: true, value: { submission: { dispatchState: 'unknown' } } })
  })

  it('replays a retried send from the journal without dispatching twice', async () => {
    await attach()
    const body = message('add a retry')
    const params = { envelope: envelope('agentSession.send', { body }), body }
    await host.send(CALLER, params)
    const retry = await host.send(CALLER, params)
    expect(retry).toMatchObject({ ok: true, replayed: true })
    expect(dispatch).toHaveBeenCalledTimes(1)
  })

  it('refuses a stale fence and hands back the current one', async () => {
    const record = await attach()
    const body = message('add a retry')
    const result = await host.send(CALLER, {
      envelope: envelope(
        'agentSession.send',
        { body },
        { expectedRuntimeFence: (record?.lease.runtimeFence ?? 1) + 5 }
      ),
      body
    })
    expect(result).toMatchObject({
      ok: false,
      refusal: { code: 'agent_session_checkpoint_stale', currentFence: record?.lease.runtimeFence }
    })
  })

  it('does not let a refused call leave a ledger row that replays past the fence', async () => {
    const record = await attach()
    const body = message('add a retry')
    const params = {
      envelope: envelope(
        'agentSession.send',
        { body },
        { expectedRuntimeFence: (record?.lease.runtimeFence ?? 1) + 5 }
      ),
      body
    }
    await host.send(CALLER, params)
    expect(await host.send(CALLER, params)).toMatchObject({
      ok: false,
      refusal: { code: 'agent_session_checkpoint_stale' }
    })
    expect(dispatch).not.toHaveBeenCalled()
  })

  it('refuses any mutation against a session this host has not attached', async () => {
    const body = message('add a retry')
    expect(
      await host.send(CALLER, { envelope: envelope('agentSession.send', { body }), body })
    ).toMatchObject({ ok: false, refusal: { code: 'agent_session_ownership_unknown' } })
  })
})

describe('cancel', () => {
  it('records the outcome as a status item keyed by the operation id', async () => {
    await attach()
    const result = await host.cancel(CALLER, {
      envelope: envelope('agentSession.cancel', { turnId: 'turn-1' }),
      turnId: 'turn-1'
    })
    expect(result).toMatchObject({ ok: true, value: { cancelled: true } })
    const page = host.history({ sessionId: SESSION, direction: 'tail' })
    expect(page.ok && page.page.items[0]?.body).toMatchObject({ kind: 'status' })
  })

  it('reports an unconfirmed cancellation rather than failing the call', async () => {
    await attach()
    cancelTurn.mockRejectedValueOnce(new Error('no answer'))
    const result = await host.cancel(CALLER, {
      envelope: envelope('agentSession.cancel', { turnId: 'turn-1' }),
      turnId: 'turn-1'
    })
    expect(result).toMatchObject({ ok: true, value: { cancelled: false } })
  })

  it('never interrupts twice on a replay', async () => {
    await attach()
    const params = {
      envelope: envelope('agentSession.cancel', { turnId: 'turn-1' }),
      turnId: 'turn-1'
    }
    await host.cancel(CALLER, params)
    expect(await host.cancel(CALLER, params)).toMatchObject({
      ok: true,
      replayed: true,
      value: { cancelled: false }
    })
    expect(cancelTurn).toHaveBeenCalledTimes(1)
  })
})

describe('respondToPrompt', () => {
  it('commits the answer before the provider callback', async () => {
    const prompt = await seedApproval()
    await attach()
    const fields = { itemId: prompt.itemId, expectedRevision: prompt.revision, optionId: 'allow' }
    const result = await host.respondToPrompt(CALLER, {
      envelope: envelope('agentSession.respondTo:approval', fields),
      kind: 'approval',
      ...fields
    })
    expect(result).toMatchObject({
      ok: true,
      value: { resolution: { state: 'resolved', selectedOptionId: 'allow' } }
    })
    expect(answerPrompt).toHaveBeenCalledTimes(1)
  })

  it('refuses a second answer to one prompt and says which answer won', async () => {
    const prompt = await seedApproval()
    await attach()
    const fields = { itemId: prompt.itemId, expectedRevision: prompt.revision, optionId: 'allow' }
    await host.respondToPrompt(CALLER, {
      envelope: envelope('agentSession.respondTo:approval', fields),
      kind: 'approval',
      ...fields
    })
    const loser = await host.respondToPrompt(
      { callerKey: 'client-2' },
      {
        envelope: envelope('agentSession.respondTo:approval', fields),
        kind: 'approval',
        ...fields
      }
    )
    expect(loser).toMatchObject({
      ok: false,
      refusal: {
        code: 'agent_session_item_revision_stale',
        resolution: { selectedOptionId: 'allow' }
      }
    })
    expect(answerPrompt).toHaveBeenCalledTimes(1)
  })

  it('refuses an option the prompt does not offer', async () => {
    const prompt = await seedApproval()
    await attach()
    const fields = { itemId: prompt.itemId, expectedRevision: prompt.revision, optionId: 'deny' }
    expect(
      await host.respondToPrompt(CALLER, {
        envelope: envelope('agentSession.respondTo:approval', fields),
        kind: 'approval',
        ...fields
      })
    ).toMatchObject({ ok: false, refusal: { code: 'agent_session_operation_invalid' } })
    expect(answerPrompt).not.toHaveBeenCalled()
  })

  it('keeps the answer and reports it undelivered when the provider callback throws', async () => {
    const prompt = await seedApproval()
    await attach()
    answerPrompt.mockRejectedValueOnce(new Error('pipe closed'))
    const fields = { itemId: prompt.itemId, expectedRevision: prompt.revision, optionId: 'allow' }
    const result = await host.respondToPrompt(CALLER, {
      envelope: envelope('agentSession.respondTo:approval', fields),
      kind: 'approval',
      ...fields
    })
    expect(result.ok).toBe(true)
    const page = host.history({ sessionId: SESSION, direction: 'tail' })
    const statusId = agentJournalItemKey({
      provider: 'orca',
      clientMessageId: `${prompt.itemId}#delivery`
    })
    expect(page.ok && page.page.items.some((entry) => entry.itemId === statusId)).toBe(true)
  })
})

describe('setOption', () => {
  it('goes to the provider and writes nothing to the journal', async () => {
    await attach()
    const fields = { key: 'model', value: 'gpt-5' }
    const result = await host.setOption(CALLER, {
      envelope: envelope('agentSession.setOption', fields),
      ...fields
    })
    expect(result).toMatchObject({ ok: true, value: fields })
    expect(setOption).toHaveBeenCalledTimes(1)
    const page = host.history({ sessionId: SESSION, direction: 'tail' })
    expect(page.ok && page.page.items).toHaveLength(0)
  })
})

describe('restart', () => {
  /** A restarted process: the same directories, a new store and a new host over
   *  them. Every lease loads unreconciled, so this is the state that decides
   *  whether a persisted session is reachable at all. */
  async function reboot(
    probeOwner: (record: AgentSessionRecord) => Promise<AgentSessionOwnerProbe>
  ) {
    store = await AgentSessionRecordStore.open({ directory: join(root, 'store'), hostId: 'local' })
    host = new StructuredAgentSessionHost({
      store,
      adapter: adapter(),
      journalRoot: root,
      claimKeyId: 'key-1',
      mintSpawnToken: () => 'spawn-b',
      probeOwner,
      now: () => NOW
    })
  }

  /** The refusal a restarted host owes a client holding the dead generation's
   *  fence: stale, with the live fence attached so the retry can succeed. */
  async function staleFenceFrom(held: number): Promise<number> {
    const refused = await host.attach(CALLER, ensureParams(held))
    if (refused.ok) {
      throw new Error('a fence from the previous host generation was accepted')
    }
    expect(refused.refusal.code).toBe('agent_session_checkpoint_stale')
    const current = refused.refusal.currentFence
    expect(current).toBeGreaterThan(held)
    return current ?? 0
  }

  it('adjudicates the leases it loaded before deciding who may write', async () => {
    const before = await attach()
    const held = before?.lease.runtimeFence ?? 0
    await reboot(async () => ({ outcome: 'pid-absent' }))

    const reattached = await host.attach(CALLER, ensureParams(await staleFenceFrom(held)))
    expect(reattached).toMatchObject({ ok: true })
    expect(store.getRecord(SESSION)?.lease.unreconciled).toBe(false)
    expect(store.getRecord(SESSION)?.lease.ownerProcess?.pid).toBe(4242)
  })

  it("keeps a session whose owner cannot be probed out of a live writer's hands", async () => {
    await attach()
    const held = store.getRecord(SESSION)?.lease.runtimeFence ?? 0
    await reboot(async () => ({ outcome: 'indeterminate', reason: 'no probe on this host' }))

    // Nothing proved the previous process dead, so the lease routes to manual
    // recovery rather than letting a second writer in behind it.
    expect(await host.attach(CALLER, ensureParams(held))).toMatchObject({
      ok: false,
      refusal: { code: 'agent_session_ownership_unknown' }
    })
  })

  it('does not remember a failed adjudication as done', async () => {
    const before = await attach()
    const held = before?.lease.runtimeFence ?? 0
    const probe = vi
      .fn<(record: AgentSessionRecord) => Promise<AgentSessionOwnerProbe>>()
      .mockRejectedValueOnce(new Error('probe exploded'))
      .mockResolvedValue({ outcome: 'pid-absent' })
    await reboot(probe)

    await expect(host.attach(CALLER, ensureParams(held))).rejects.toThrow('probe exploded')
    // One unlucky startup must not strand the session for this host's lifetime.
    const reattached = await host.attach(CALLER, ensureParams(await staleFenceFrom(held)))
    expect(reattached).toMatchObject({ ok: true })
    expect(probe).toHaveBeenCalledTimes(2)
  })
})

describe('subscribe', () => {
  it('opens with a snapshot and then streams cursor-qualified batches', async () => {
    await attach()
    const events: AgentSessionSubscribeEvent[] = []
    const dispose = host.subscribe({
      id: 'sub-1',
      sessionId: SESSION,
      emit: (event) => events.push(event)
    })
    const body = message('add a retry')
    await host.send(CALLER, { envelope: envelope('agentSession.send', { body }), body })

    expect(events[0]?.type).toBe('snapshot')
    const batches = events.filter((event) => event.type === 'batch')
    expect(batches.length).toBeGreaterThan(0)
    const last = batches.at(-1)
    expect(last?.type === 'batch' && last.batch.cursor.sequence).toBeGreaterThan(0)

    dispose()
    expect(events.at(-1)?.type).toBe('end')
  })

  it('resumes from a client cursor with only the rows it missed', async () => {
    await attach()
    const body = message('add a retry')
    const first = await host.send(CALLER, {
      envelope: envelope('agentSession.send', { body }),
      body
    })
    if (!first.ok) {
      throw new Error(`expected a send, got ${first.refusal.code}`)
    }

    const events: AgentSessionSubscribeEvent[] = []
    host.subscribe({
      id: 'sub-2',
      sessionId: SESSION,
      emit: (event) => events.push(event),
      cursor: first.cursor
    })
    // Nothing new since that cursor: a resume is silent, not a redundant replay.
    expect(events).toHaveLength(0)

    const second = message('and a timeout')
    await host.send(CALLER, {
      envelope: envelope('agentSession.send', { body: second }),
      body: second
    })
    expect(events.some((event) => event.type === 'batch')).toBe(true)
    expect(events.some((event) => event.type === 'snapshot')).toBe(false)
  })

  it('resets a subscriber whose epoch is gone', async () => {
    await attach()
    const events: AgentSessionSubscribeEvent[] = []
    host.subscribe({
      id: 'sub-3',
      sessionId: SESSION,
      emit: (event) => events.push(event),
      cursor: { epoch: 'epoch-from-a-previous-life', sequence: 3 }
    })
    expect(events[0]).toMatchObject({ type: 'reset', reset: 'epoch_changed' })
  })
})
