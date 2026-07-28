import type { IPtyProvider } from '../providers/types'
import type { Repo } from '../../shared/types'
import { splitWorktreeId } from '../../shared/worktree-id'
import { mapWithConcurrency } from '../../shared/map-with-concurrency'
import type { OrcaRuntimeService } from './orca-runtime'
import { killAllProcessesForWorktree } from './worktree-teardown'

const MISSING_WORKTREE_TEARDOWN_CONCURRENCY = 4

type MissingWorktreeTerminalReconciliationDeps = {
  runtime: OrcaRuntimeService
  getLocalProvider: () => IPtyProvider | null
  getSshProvider: (connectionId: string) => IPtyProvider | undefined
  onPtyStopped?: (ptyId: string) => void
}

export async function stopMissingWorktreeTerminals(
  repo: Repo,
  knownWorktreeIds: readonly string[],
  detectedWorktreeIds: readonly string[],
  deps: MissingWorktreeTerminalReconciliationDeps
): Promise<{ stoppedWorktreeIds: string[] }> {
  const detectedIds = new Set(detectedWorktreeIds)
  const missingIds = [
    ...new Set(
      knownWorktreeIds.filter(
        (worktreeId) =>
          splitWorktreeId(worktreeId)?.repoId === repo.id && !detectedIds.has(worktreeId)
      )
    )
  ]
  if (missingIds.length === 0) {
    return { stoppedWorktreeIds: [] }
  }

  const provider = repo.connectionId
    ? deps.getSshProvider(repo.connectionId)
    : deps.getLocalProvider()
  if (!provider) {
    const stoppedWorktreeIds = (
      await mapWithConcurrency(
        missingIds,
        MISSING_WORKTREE_TEARDOWN_CONCURRENCY,
        async (worktreeId) => {
          try {
            await deps.runtime.stopTerminalsForWorktree(worktreeId)
            return worktreeId
          } catch {
            return null
          }
        }
      )
    ).filter((worktreeId): worktreeId is string => worktreeId !== null)
    return { stoppedWorktreeIds }
  }

  const stoppedWorktreeIds = (
    await mapWithConcurrency(
      missingIds,
      MISSING_WORKTREE_TEARDOWN_CONCURRENCY,
      async (worktreeId) => {
        try {
          await killAllProcessesForWorktree(worktreeId, {
            runtime: deps.runtime,
            localProvider: provider,
            onPtyStopped: deps.onPtyStopped,
            ...(repo.connectionId ? { includeLocalRegistry: false } : {})
          })
          return worktreeId
        } catch (error) {
          console.warn(`[worktree-teardown] Failed to stop missing workspace ${worktreeId}`, error)
          return null
        }
      }
    )
  ).filter((worktreeId): worktreeId is string => worktreeId !== null)

  return { stoppedWorktreeIds }
}
