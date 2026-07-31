import { describe, expect, it } from 'vitest'
import { deriveTaskPagePRCheckSummary } from './task-page-pr-check-summary'
import { gitLabPipelineJobsToPRChecks } from '../../../shared/gitlab-pipeline-checks'
import { derivePRCheckStatus, derivePRCheckStatusFromRollup } from '../../../shared/pr-check-status'
import { summarizeProviderChecks } from '../../../shared/provider-check-summary'
import type { GitLabPipelineJob } from '../../../shared/gitlab-types'
import type { PRCheckDetail, ProviderCheckSummary } from '../../../shared/types'

function completed(conclusion: string): PRCheckDetail {
  return {
    name: conclusion,
    status: 'completed',
    conclusion: conclusion as PRCheckDetail['conclusion'],
    url: null
  }
}

function gitLabJobs(...statuses: string[]): PRCheckDetail[] {
  return gitLabPipelineJobsToPRChecks(
    statuses.map(
      (status, index): GitLabPipelineJob => ({
        id: index,
        name: status,
        stage: 'deploy',
        status,
        webUrl: '',
        duration: null
      })
    )
  )
}

// Why: GraphQL rollups arrive upper-cased and status-first; the main process must land on the
// same verdict as the renderer for the same checks.
function toGraphQLRollup(check: PRCheckDetail): { status: string; conclusion: string | null } {
  return {
    status: check.status.toUpperCase(),
    conclusion: check.conclusion ? check.conclusion.toUpperCase() : null
  }
}

type ParityCase = {
  name: string
  checks: PRCheckDetail[]
  expected: Omit<ProviderCheckSummary, 'total'>
}

const PARITY_CASES: ParityCase[] = [
  {
    name: 'all success',
    checks: [completed('success'), completed('success')],
    expected: { state: 'success', passed: 2, failed: 0, pending: 0, neutral: 0 }
  },
  {
    name: 'success plus skipped',
    checks: [completed('success'), completed('skipped')],
    expected: { state: 'success', passed: 2, failed: 0, pending: 0, neutral: 0 }
  },
  {
    name: 'all skipped',
    checks: [completed('skipped'), completed('skipped')],
    expected: { state: 'success', passed: 2, failed: 0, pending: 0, neutral: 0 }
  },
  {
    name: 'success plus neutral',
    checks: [completed('success'), completed('neutral')],
    expected: { state: 'success', passed: 1, failed: 0, pending: 0, neutral: 1 }
  },
  {
    name: 'all neutral',
    checks: [completed('neutral')],
    expected: { state: 'neutral', passed: 0, failed: 0, pending: 0, neutral: 1 }
  },
  {
    name: 'success plus failure',
    checks: [completed('success'), completed('failure')],
    expected: { state: 'failure', passed: 1, failed: 1, pending: 0, neutral: 0 }
  },
  {
    name: 'success plus running',
    checks: [
      completed('success'),
      { name: 'ci', status: 'in_progress', conclusion: null, url: null }
    ],
    expected: { state: 'pending', passed: 1, failed: 0, pending: 1, neutral: 0 }
  },
  {
    name: 'GitLab manual gate only',
    checks: gitLabJobs('manual'),
    expected: { state: 'neutral', passed: 0, failed: 0, pending: 0, neutral: 1 }
  },
  {
    name: 'GitLab manual gate alongside a green pipeline',
    checks: gitLabJobs('manual', 'success'),
    expected: { state: 'success', passed: 1, failed: 0, pending: 0, neutral: 1 }
  },
  {
    name: 'genuine action_required',
    checks: [completed('success'), completed('action_required')],
    expected: { state: 'failure', passed: 1, failed: 1, pending: 0, neutral: 0 }
  }
]

describe('provider check classification parity', () => {
  it.each(PARITY_CASES)(
    '$name resolves identically on every desktop surface',
    ({ checks, expected }) => {
      const summary = { ...expected, total: checks.length }
      expect(summarizeProviderChecks(checks)).toEqual(summary)
      expect(deriveTaskPagePRCheckSummary(checks)).toEqual(summary)
      expect(derivePRCheckStatus(checks)).toBe(expected.state)
      expect(derivePRCheckStatusFromRollup(checks.map(toGraphQLRollup))).toBe(expected.state)
    }
  )
})
