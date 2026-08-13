import { useAppStore } from '@/store'
import type { Repo, WorktreeVisibilityDefaults } from '../../../../shared/types'
import { getRepoOwnerWorktreeVisibilityDefaults } from '../../store/worktree-visibility-defaults-by-host'

export function useRepoOwnerVisibilityDefaults(
  repo: Repo | null
): WorktreeVisibilityDefaults | undefined {
  const settings = useAppStore((state) => state.settings)
  const defaultsByHost = useAppStore((state) => state.worktreeVisibilityDefaultsByHost)
  return repo ? getRepoOwnerWorktreeVisibilityDefaults(repo, settings, defaultsByHost) : undefined
}
