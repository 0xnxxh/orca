import type { GitLabJobTraceResult, PRCheckDetail, PRCheckRunDetails } from '../../../shared/types'
import { gitLabJobTraceToCheckRunDetails } from '../../../shared/gitlab-job-trace-check-details'
import { callRuntimeRpc, getActiveRuntimeTarget } from '@/runtime/runtime-rpc-client'

/**
 * Loads a GitLab job trace from the worktree's runtime owner and adapts it to
 * the provider-neutral check-details shape used by the sidebar and editor.
 */
export async function loadGitLabCheckRunDetails(args: {
  repoPath: string
  repoId?: string
  settings: Parameters<typeof getActiveRuntimeTarget>[0]
  check: PRCheckDetail
}): Promise<PRCheckRunDetails | null> {
  const jobId = args.check.gitlabJobId
  if (!jobId) {
    return null
  }
  const target = getActiveRuntimeTarget(args.settings)
  const result =
    target.kind === 'environment'
      ? await callRuntimeRpc<GitLabJobTraceResult>(
          target,
          'gitlab.jobTrace',
          { repo: args.repoId ?? args.repoPath, jobId },
          { timeoutMs: 30_000 }
        )
      : ((await window.api.gl.jobTrace({
          repoPath: args.repoPath,
          repoId: args.repoId,
          jobId
        })) as GitLabJobTraceResult)
  if (!result.ok) {
    throw new Error(result.error || 'Failed to load GitLab job log.')
  }
  return gitLabJobTraceToCheckRunDetails(args.check, result.trace)
}
