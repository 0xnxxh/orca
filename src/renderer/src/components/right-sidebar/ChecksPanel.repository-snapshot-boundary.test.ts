import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

const SOURCE = readFileSync(join(__dirname, 'ChecksPanel.tsx'), 'utf8')
const RUNTIME_SUBSCRIPTION_SOURCE = readFileSync(
  join(__dirname, '../../../../preload/runtime-environment-subscriptions.ts'),
  'utf8'
)

describe('ChecksPanel repository snapshot boundary', () => {
  it('uses runtime-owner snapshots only for automatic eligibility and keeps manual refresh fresh', () => {
    const automaticStart = SOURCE.indexOf('shouldCoalesceChecksPanelGitStatusSnapshotRefresh')
    const automaticEnd = SOURCE.indexOf('const handleRefresh = useCallback')
    const automatic = SOURCE.slice(automaticStart, automaticEnd)
    const manual = SOURCE.slice(automaticEnd, SOURCE.indexOf('const handleCancelRun', automaticEnd))

    expect(automatic).toContain('getChecksPanelRepositorySnapshot')
    expect(automatic).toContain('getRuntimeGitStatus')
    expect(automatic).toContain('getRuntimeGitUpstreamStatus')
    expect(manual).toContain('getRuntimeGitStatus')
    expect(manual).toContain('getRuntimeGitUpstreamStatus')
    expect(manual).not.toContain('getChecksPanelRepositorySnapshot')
  })

  it('cannot dispatch an IPC invalidation between current-read admission and its commit turn', () => {
    const admissionStart = SOURCE.indexOf(
      'if (gitStatusSnapshotRevision.isReadCurrent(revisionRead))'
    )
    const admittedReturn = SOURCE.indexOf('return repositorySnapshot', admissionStart)
    const stateContinuation = SOURCE.indexOf('.then((snapshot) =>', admittedReturn)
    const admission = SOURCE.slice(admissionStart, admittedReturn)
    const dispatcherStart = RUNTIME_SUBSCRIPTION_SOURCE.indexOf('const listener = (_event: unknown')
    const dispatcherEnd = RUNTIME_SUBSCRIPTION_SOURCE.indexOf(
      'const dispatcher: RuntimeEnvironmentSubscriptionDispatcher',
      dispatcherStart
    )
    const dispatcher = RUNTIME_SUBSCRIPTION_SOURCE.slice(dispatcherStart, dispatcherEnd)

    expect(admissionStart).toBeGreaterThan(-1)
    expect(admittedReturn).toBeGreaterThan(admissionStart)
    expect(stateContinuation).toBeGreaterThan(admittedReturn)
    expect(admission).not.toContain('await')
    expect(dispatcher).toContain('subscriptionCallbacks.onResponse(event.response)')
    expect(dispatcher).not.toContain('queueMicrotask')
    expect(dispatcher).not.toContain('await')
  })
})
