import { afterEach, describe, expect, it, vi } from 'vitest'
import { runAgentStatusBatchWorkload } from './idle-cpu-agent-status-batch-workload.mjs'

function createStore({ includeBatchAction = true } = {}) {
  const listeners = new Set()
  const batchCalls = []
  let state
  const notify = () => {
    for (const listener of listeners) {
      listener(state, state)
    }
  }
  const applyUpdates = (updates) => {
    const agentStatusByPaneKey = { ...state.agentStatusByPaneKey }
    for (const update of updates) {
      const previous = agentStatusByPaneKey[update.paneKey]
      agentStatusByPaneKey[update.paneKey] = {
        ...previous,
        ...update.payload,
        paneKey: update.paneKey,
        updatedAt: update.timing.updatedAt,
        stateStartedAt: update.timing.stateStartedAt
      }
    }
    state = { ...state, agentStatusByPaneKey }
  }
  const setAgentStatus = (paneKey, payload, terminalTitle, timing, routing) => {
    applyUpdates([{ paneKey, payload, terminalTitle, timing, routing }])
    notify()
  }
  const setAgentStatuses = (updates) => {
    batchCalls.push(updates)
    applyUpdates(updates)
    notify()
  }
  state = {
    agentStatusByPaneKey: {
      'tab-a:pane-a': {
        paneKey: 'tab-a:pane-a',
        state: 'working',
        prompt: 'Idle CPU agent 1.1',
        agentType: 'codex',
        tabId: 'tab-a',
        worktreeId: 'worktree-a',
        updatedAt: 10,
        stateStartedAt: 10
      },
      'tab-b:pane-b': {
        paneKey: 'tab-b:pane-b',
        state: 'working',
        prompt: 'Idle CPU agent 2.1',
        agentType: 'claude',
        tabId: 'tab-b',
        worktreeId: 'worktree-b',
        updatedAt: 11,
        stateStartedAt: 11
      }
    },
    setAgentStatus,
    ...(includeBatchAction ? { setAgentStatuses } : {})
  }
  return {
    batchCalls,
    getState: () => state,
    subscribe: (listener) => {
      listeners.add(listener)
      return () => listeners.delete(listener)
    }
  }
}

async function run(store, options) {
  vi.stubGlobal('window', { __store: store })
  const page = { evaluate: (callback, args) => callback(args) }
  return runAgentStatusBatchWorkload(page, options)
}

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('idle CPU ordered agent-status workload', () => {
  it('runs repeated ordered updates through one batch action per burst', async () => {
    const store = createStore()
    const result = await run(store, {
      batchCount: 2,
      updatesPerBatch: 8,
      intervalMs: 1,
      writeMode: 'batch'
    })

    expect(store.batchCalls).toHaveLength(2)
    expect(store.batchCalls[0].map((update) => update.payload.state)).toEqual([
      'waiting',
      'waiting',
      'blocked',
      'blocked',
      'working',
      'working',
      'waiting',
      'waiting'
    ])
    expect(result).toMatchObject({
      workloadPattern: 'ordered-round-robin-v1',
      action: 'setAgentStatuses',
      requestedBatches: 2,
      completedBatches: 2,
      requestedUpdates: 16,
      completedUpdates: 16,
      actionInvocations: 2,
      targetPaneCount: 2,
      repeatedTargetUpdates: 14,
      synchronousStorePublications: 2,
      publicationsPerBatch: 1,
      publicationsPerAction: 1,
      updatesPerSecond: expect.any(Number),
      verification: { checkedTargets: 2, mismatchedTargets: 0, passed: true }
    })
    expect(JSON.stringify(result)).not.toContain('pane-a')
    expect(JSON.stringify(result)).not.toContain('Idle CPU ordered status')
  })

  it('runs the identical stream through legacy sequential writes', async () => {
    const result = await run(createStore(), {
      batchCount: 1,
      updatesPerBatch: 12,
      intervalMs: 1,
      writeMode: 'sequential'
    })

    expect(result).toMatchObject({
      action: 'setAgentStatus',
      completedBatches: 1,
      completedUpdates: 12,
      actionInvocations: 12,
      synchronousStorePublications: 12,
      publicationsPerBatch: 12,
      publicationsPerAction: 1,
      verification: { passed: true }
    })
  })

  it('fails batch mode clearly when the candidate action is unavailable', async () => {
    await expect(
      run(createStore({ includeBatchAction: false }), {
        batchCount: 1,
        updatesPerBatch: 1,
        intervalMs: 1,
        writeMode: 'batch'
      })
    ).rejects.toThrow('setAgentStatuses is not available')
  })
})
