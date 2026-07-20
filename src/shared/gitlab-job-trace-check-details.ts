import type { PRCheckDetail, PRCheckRunDetails } from './types'

// Why: GitLab job traces can be megabytes; the Checks panel only needs the tail
// to surface the failure, matching the GitHub log-excerpt behavior.
const GITLAB_TRACE_TAIL_LINES = 200

function sliceTraceTail(trace: string): string {
  // Walk back from the end over N newlines instead of splitting the whole
  // (possibly multi-MB) trace into an array we'd immediately discard all but the tail of.
  let cut = trace.length
  for (let remaining = GITLAB_TRACE_TAIL_LINES; remaining > 0; remaining--) {
    const newline = trace.lastIndexOf('\n', cut - 1)
    if (newline === -1) {
      return trace
    }
    cut = newline
  }
  return trace.slice(cut + 1)
}

/**
 * Adapts a GitLab job trace into the shared `PRCheckRunDetails` shape so the
 * Checks panel and full-details tab can reuse the GitHub rendering path. GitLab
 * exposes a single flat trace per job rather than GitHub's step/annotation
 * breakdown, so the trace lands in one synthetic job's `logTail`.
 */
export function gitLabJobTraceToCheckRunDetails(
  check: PRCheckDetail,
  trace: string
): PRCheckRunDetails {
  const logTail = sliceTraceTail(trace).trim()
  return {
    name: check.name,
    status: check.status,
    conclusion: check.conclusion,
    url: check.url,
    detailsUrl: check.url,
    startedAt: null,
    completedAt: null,
    title: null,
    summary: null,
    text: null,
    annotations: [],
    jobs: logTail
      ? [
          {
            id: check.gitlabJobId ?? null,
            name: check.name,
            status: check.status,
            conclusion: check.conclusion,
            startedAt: null,
            completedAt: null,
            url: check.url,
            logTail,
            steps: []
          }
        ]
      : []
  }
}
