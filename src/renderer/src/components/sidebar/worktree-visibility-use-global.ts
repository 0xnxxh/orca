import type { Repo, WorktreeVisibilityDefaults } from '../../../../shared/types'
import {
  effectiveExternalWorktreeVisibility,
  isLegacyRepoForExternalWorktreeVisibility
} from '../../../../shared/external-worktree-visibility'
import {
  effectiveBuiltInWorktreeSourceVisibility,
  effectiveCustomWorktreeSourceVisibility,
  normalizeWorktreeVisibilitySourcePreferences
} from '../../../../shared/worktree-visibility-sources'
import {
  removeBuiltInWorktreeSourcePreference,
  removeCustomWorktreeSourcePreference
} from '../../../../shared/worktree-visibility-source-preferences'
import type { RepoUpdate } from '@/store/slices/repos'
import type { WorktreeVisibilitySourceRow } from './WorktreeVisibilitySourceList'

type UseGlobalMutation = {
  updates: RepoUpdate
  isAccepted: (latestRepo: Repo) => boolean
}

export function createWorktreeVisibilityUseGlobalMutation(
  repo: Repo,
  source: WorktreeVisibilitySourceRow,
  visibilityDefaults: WorktreeVisibilityDefaults | undefined
): UseGlobalMutation {
  if (source.kind === 'other') {
    return {
      updates: { externalWorktreeVisibility: null },
      isAccepted: (latestRepo) =>
        latestRepo.externalWorktreeVisibility === undefined &&
        effectiveExternalWorktreeVisibility(
          latestRepo,
          isLegacyRepoForExternalWorktreeVisibility(latestRepo),
          visibilityDefaults
        ) === effectiveExternalWorktreeVisibility({}, false, visibilityDefaults)
    }
  }
  if (source.kind === 'built-in') {
    return {
      updates: {
        agentWorktreeVisibility: null,
        worktreeVisibilitySourcePreferences: removeBuiltInWorktreeSourcePreference(repo, source.id)
      },
      isAccepted: (latestRepo) =>
        latestRepo.agentWorktreeVisibility === undefined &&
        normalizeWorktreeVisibilitySourcePreferences(latestRepo.worktreeVisibilitySourcePreferences)
          ?.builtIn?.[source.id] === undefined &&
        effectiveBuiltInWorktreeSourceVisibility(latestRepo, source.id, visibilityDefaults) ===
          effectiveBuiltInWorktreeSourceVisibility({}, source.id, visibilityDefaults)
    }
  }
  return {
    updates: {
      worktreeVisibilitySourcePreferences: removeCustomWorktreeSourcePreference(
        repo,
        source.source.id
      )
    },
    isAccepted: (latestRepo) =>
      normalizeWorktreeVisibilitySourcePreferences(latestRepo.worktreeVisibilitySourcePreferences)
        ?.custom?.[source.source.id] === undefined &&
      effectiveCustomWorktreeSourceVisibility(latestRepo, source.source.id, visibilityDefaults) ===
        effectiveCustomWorktreeSourceVisibility({}, source.source.id, visibilityDefaults)
  }
}
