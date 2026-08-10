import { afterEach, describe, expect, it, vi } from 'vitest'
import { Coordinator, DISPATCH_STALE_THRESHOLD, type CoordinatorRuntime } from './coordinator'
import { OrchestrationDb } from './db'

describe('Coordinator drift probe coalescing', () => {
  let db: OrchestrationDb

  afterEach(() => {
    db?.close()
  })

  it('shares one drift snapshot across a tick and probes again on the next tick', async () => {
    db = new OrchestrationDb(':memory:')
    const sentMessages: { handle: string; text: string }[] = []
    const probeDriftCalls: string[] = []
    const terminals = [
      { handle: 'term_a', worktreeId: 'wt1', connected: true, writable: true },
      { handle: 'term_b', worktreeId: 'wt1', connected: true, writable: true }
    ]
    const runtime: CoordinatorRuntime = {
      async sendTerminalAgentPrompt(handle, prompt) {
        sentMessages.push({ handle, text: prompt })
        return { accepted: true }
      },
      async listTerminals() {
        return { terminals }
      },
      async createTerminal() {
        throw new Error('unexpected terminal create')
      },
      async waitForTerminal(handle) {
        return { handle, condition: 'exit' }
      },
      async probeWorktreeDrift(worktreeSelector) {
        probeDriftCalls.push(worktreeSelector)
        return probeDriftCalls.length === 1
          ? {
              base: 'origin/main',
              behind: DISPATCH_STALE_THRESHOLD + 1,
              recentSubjects: ['stale']
            }
          : { base: 'origin/main', behind: 0, recentSubjects: [] }
      }
    }
    const first = db.createTask({ spec: 'first task' })
    const second = db.createTask({ spec: 'second task' })
    const coordinator = new Coordinator(db, runtime, {
      spec: 'go',
      coordinatorHandle: 'coord',
      pollIntervalMs: 30,
      worktree: 'wt1'
    })

    const runPromise = coordinator.run()
    await vi.waitFor(() => expect(sentMessages).toHaveLength(2))

    expect(probeDriftCalls).toEqual(['wt1', 'wt1'])
    expect(sentMessages.map((message) => message.handle).sort()).toEqual(['term_a', 'term_b'])

    for (const task of [first, second]) {
      const dispatch = db.getDispatchContext(task.id)
      if (!dispatch?.assignee_handle) {
        throw new Error(`missing dispatch for ${task.id}`)
      }
      db.insertMessage({
        from: dispatch.assignee_handle,
        to: 'coord',
        subject: 'Done',
        type: 'worker_done',
        payload: JSON.stringify({ taskId: task.id, dispatchId: dispatch.id, outcome: 'succeeded' })
      })
    }

    await expect(runPromise).resolves.toMatchObject({ status: 'completed' })
  })
})
