export const DEFAULT_AGENT_STATUS_BATCH_INTERVAL_MS = 100
export const DEFAULT_AGENT_STATUS_UPDATES_PER_BATCH = 100

export async function runAgentStatusBatchWorkload(page, options) {
  return page.evaluate(
    ({ batchCount, updatesPerBatch, intervalMs, writeMode }) =>
      new Promise((resolve, reject) => {
        const store = window.__store
        if (!store) {
          reject(new Error('window.__store is not available'))
          return
        }
        if (writeMode === 'batch' && typeof store.getState().setAgentStatuses !== 'function') {
          reject(
            new Error(
              'setAgentStatuses is not available; build the batch candidate or use --agent-status-write-mode sequential'
            )
          )
          return
        }
        const maxSamples = 5_000
        const round = (value) => Math.round(value * 100) / 100
        const summarize = (values, totalCount) => {
          const sorted = [...values].sort((left, right) => left - right)
          const percentile = (fraction) =>
            sorted.length === 0
              ? null
              : sorted[Math.min(sorted.length - 1, Math.ceil(sorted.length * fraction) - 1)]
          return {
            count: totalCount,
            retainedCount: sorted.length,
            mean:
              sorted.length === 0
                ? null
                : round(sorted.reduce((sum, value) => sum + value, 0) / sorted.length),
            p50: sorted.length === 0 ? null : round(percentile(0.5)),
            p95: sorted.length === 0 ? null : round(percentile(0.95)),
            max: sorted.length === 0 ? null : round(sorted.at(-1))
          }
        }
        const startedAt = performance.now()
        const startedAtIso = new Date().toISOString()
        const initialState = store.getState()
        const targets = Object.entries(initialState.agentStatusByPaneKey ?? {})
          .filter(([, entry]) => entry.prompt?.startsWith('Idle CPU agent '))
          .sort(([left], [right]) => (left < right ? -1 : left > right ? 1 : 0))
          .map(([paneKey, entry]) => ({
            paneKey,
            agentType: entry.agentType ?? 'codex',
            terminalTitle: entry.terminalTitle,
            routing: {
              ...(entry.tabId ? { tabId: entry.tabId } : {}),
              ...(entry.worktreeId ? { worktreeId: entry.worktreeId } : {}),
              ...(entry.terminalHandle ? { terminalHandle: entry.terminalHandle } : {}),
              ...(entry.connectionId !== undefined ? { connectionId: entry.connectionId } : {})
            },
            updatedAt: entry.updatedAt
          }))
        if (batchCount > 0 && targets.length === 0) {
          reject(
            new Error(
              'Agent-status workloads require seeded rows; pass --agents-per-worktree with a positive value'
            )
          )
          return
        }
        const baseUpdatedAt =
          Math.max(Date.now(), ...targets.map((target) => target.updatedAt ?? 0)) + 1_000
        const expectedByPaneKey = new Map()
        const schedulingDriftMs = []
        const actionDurationMs = []
        const states = ['waiting', 'blocked', 'working']
        let completedBatches = 0
        let completedUpdates = 0
        let actionInvocations = 0
        let synchronousStorePublications = 0
        let totalActionDurationMs = 0
        let actionActive = false
        const unsubscribe = store.subscribe(() => {
          if (actionActive) {
            synchronousStorePublications += 1
          }
        })
        const retainSample = (samples, value) => {
          samples.push(value)
          if (samples.length > maxSamples) {
            samples.shift()
          }
        }
        const finish = () => {
          unsubscribe()
          const finalEntries = store.getState().agentStatusByPaneKey ?? {}
          let mismatchedTargets = 0
          for (const [paneKey, expected] of expectedByPaneKey) {
            const actual = finalEntries[paneKey]
            if (
              actual?.state !== expected.state ||
              actual?.prompt !== expected.prompt ||
              actual?.updatedAt !== expected.updatedAt
            ) {
              mismatchedTargets += 1
            }
          }
          resolve({
            workloadPattern: 'ordered-round-robin-v1',
            writeMode,
            action: writeMode === 'batch' ? 'setAgentStatuses' : 'setAgentStatus',
            requestedBatches: batchCount,
            completedBatches,
            updatesPerBatch,
            requestedUpdates: batchCount * updatesPerBatch,
            completedUpdates,
            actionInvocations,
            targetPaneCount: targets.length,
            repeatedTargetUpdates: Math.max(0, completedUpdates - expectedByPaneKey.size),
            intervalMs,
            startedAt: startedAtIso,
            completedAt: new Date().toISOString(),
            durationMs: round(performance.now() - startedAt),
            totalActionDurationMs: round(totalActionDurationMs),
            updatesPerSecond:
              totalActionDurationMs === 0
                ? null
                : round(completedUpdates / (totalActionDurationMs / 1_000)),
            synchronousStorePublications,
            publicationsPerBatch:
              completedBatches === 0
                ? null
                : round(synchronousStorePublications / completedBatches),
            publicationsPerAction:
              actionInvocations === 0
                ? null
                : round(synchronousStorePublications / actionInvocations),
            schedulingDriftMs: summarize(schedulingDriftMs, completedBatches),
            actionDurationMs: summarize(actionDurationMs, completedBatches),
            verification: {
              checkedTargets: expectedByPaneKey.size,
              mismatchedTargets,
              passed: mismatchedTargets === 0
            }
          })
        }
        const buildUpdates = (batchIndex) => {
          const updates = []
          for (let updateIndex = 0; updateIndex < updatesPerBatch; updateIndex += 1) {
            const sequence = batchIndex * updatesPerBatch + updateIndex
            const targetIndex = sequence % targets.length
            const target = targets[targetIndex]
            const targetSequence = Math.floor(sequence / targets.length)
            const state = states[targetSequence % states.length]
            const prompt = `Idle CPU ordered status ${sequence}`
            const updatedAt = baseUpdatedAt + sequence
            const update = {
              paneKey: target.paneKey,
              payload: { state, prompt, agentType: target.agentType },
              terminalTitle: target.terminalTitle,
              timing: { updatedAt, stateStartedAt: updatedAt },
              routing: target.routing
            }
            updates.push(update)
            expectedByPaneKey.set(target.paneKey, { state, prompt, updatedAt })
          }
          return updates
        }
        const runBatch = () => {
          const scheduledAt = startedAt + completedBatches * intervalMs
          retainSample(schedulingDriftMs, Math.max(0, performance.now() - scheduledAt))
          const updates = buildUpdates(completedBatches)
          const actionStartedAt = performance.now()
          actionActive = true
          try {
            if (writeMode === 'batch') {
              store.getState().setAgentStatuses(updates)
              actionInvocations += 1
            } else {
              for (const update of updates) {
                store
                  .getState()
                  .setAgentStatus(
                    update.paneKey,
                    update.payload,
                    update.terminalTitle,
                    update.timing,
                    update.routing
                  )
                actionInvocations += 1
              }
            }
          } catch (error) {
            actionActive = false
            unsubscribe()
            reject(error)
            return
          }
          actionActive = false
          const actionDuration = performance.now() - actionStartedAt
          totalActionDurationMs += actionDuration
          retainSample(actionDurationMs, actionDuration)
          completedBatches += 1
          completedUpdates += updates.length
          if (completedBatches >= batchCount) {
            finish()
            return
          }
          const nextAt = startedAt + completedBatches * intervalMs
          setTimeout(runBatch, Math.max(0, nextAt - performance.now()))
        }
        if (batchCount === 0) {
          finish()
        } else {
          setTimeout(runBatch, 0)
        }
      }),
    options
  )
}
