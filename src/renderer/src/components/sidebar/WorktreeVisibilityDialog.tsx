import React, { useCallback, useEffect, useState } from 'react'
import { Eye, EyeOff } from 'lucide-react'
import { useAppStore } from '@/store'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle
} from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import {
  getHiddenExternalWorktrees,
  getHiddenImportableExternalWorktrees,
  getVisibleExternalWorktrees
} from '../../../../shared/external-worktree-inbox'
import { isGitRepoKind } from '../../../../shared/repo-kind'
import { relativePathInsideRoot } from '../../../../shared/cross-platform-path'
import {
  effectiveExternalWorktreeVisibility,
  isLegacyRepoForExternalWorktreeVisibility
} from '../../../../shared/worktree-ownership'
import { translate } from '@/i18n/i18n'
import {
  importNewExternalWorktreeInboxPaths,
  type NewExternalWorktreesInboxActionState
} from './new-external-worktrees-inbox-actions'

export default function WorktreeVisibilityDialog(): React.JSX.Element | null {
  const activeModal = useAppStore((s) => s.activeModal)
  const modalData = useAppStore((s) => s.modalData)
  const closeModal = useAppStore((s) => s.closeModal)
  const repos = useAppStore((s) => s.repos)
  const updateRepo = useAppStore((s) => s.updateRepo)
  const fetchWorktrees = useAppStore((s) => s.fetchWorktrees)
  const detectedWorktreesByRepo = useAppStore((s) => s.detectedWorktreesByRepo)
  const [actionState, setActionState] = useState<NewExternalWorktreesInboxActionState | null>(null)
  const [busyPath, setBusyPath] = useState<string | null>(null)
  const [listState, setListState] = useState<'checking' | 'ready' | 'failed'>('checking')

  const isOpen = activeModal === 'worktree-visibility'
  const repoId = typeof modalData.repoId === 'string' ? modalData.repoId : ''
  const repo = repos.find((candidate) => candidate.id === repoId) ?? null
  const detected = repoId ? detectedWorktreesByRepo[repoId] : undefined
  const showOther = repo
    ? effectiveExternalWorktreeVisibility(repo, isLegacyRepoForExternalWorktreeVisibility(repo)) ===
      'show'
    : false
  const hiddenCount = getHiddenExternalWorktrees(detected).length
  const otherCount = getVisibleExternalWorktrees(detected).length
  const hiddenImportable = getHiddenImportableExternalWorktrees(detected)
  const hiddenWorktreeLabel = `${hiddenCount} ${hiddenCount === 1 ? 'worktree' : 'worktrees'}`
  const shownWorktreeLabel = `${otherCount} ${otherCount === 1 ? 'worktree' : 'worktrees'}`

  // Why: recovery must not trust a stale or fallback snapshot — an empty one
  // would read as "nothing hidden" for a worktree that is sitting on disk (#10324).
  useEffect(() => {
    if (!isOpen || !repoId) {
      return
    }
    let cancelled = false
    setListState('checking')
    void fetchWorktrees(repoId, { requireAuthoritative: true }).then((refreshed) => {
      if (!cancelled) {
        setListState(refreshed ? 'ready' : 'failed')
      }
    })
    return () => {
      cancelled = true
    }
  }, [fetchWorktrees, isOpen, repoId])

  const handleRetryList = useCallback(async () => {
    if (!repoId) {
      return
    }
    setListState('checking')
    const refreshed = await fetchWorktrees(repoId, { requireAuthoritative: true })
    setListState(refreshed ? 'ready' : 'failed')
  }, [fetchWorktrees, repoId])

  const handleShowWorktree = useCallback(
    async (worktreePath: string) => {
      if (!repo) {
        return
      }
      setBusyPath(worktreePath)
      await importNewExternalWorktreeInboxPaths({
        projectId: repo.id,
        repo,
        worktreePaths: [worktreePath],
        updateRepo,
        fetchWorktrees,
        setInboxState: (_projectId, state) => {
          setActionState(state)
          // Why: a null state is only reachable after a successful authoritative
          // refetch, which supersedes an earlier failed open-time scan.
          if (state === null) {
            setListState('ready')
          }
        }
      })
      setBusyPath(null)
    },
    [fetchWorktrees, repo, updateRepo]
  )

  const handleToggle = useCallback(async () => {
    if (!repoId) {
      return
    }
    await updateRepo(repoId, {
      externalWorktreeVisibility: showOther ? 'hide' : 'show',
      // Why: showing hidden externals again should re-enable the inbox if the
      // user previously opted out of discovery prompts for this repo.
      // Why: null is the transport sentinel for clearing on remote runtime paths
      // where `undefined` is stripped before persistence.
      ...(!showOther ? { externalWorktreeDiscoverySuppressedAt: null } : {})
    })
    await fetchWorktrees(repoId)
    closeModal()
  }, [closeModal, fetchWorktrees, repoId, showOther, updateRepo])

  if (!isOpen || !repo || !isGitRepoKind(repo)) {
    return null
  }

  return (
    <Dialog open onOpenChange={(open) => !open && closeModal()}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>
            {translate(
              'auto.components.sidebar.WorktreeVisibilityDialog.83a5ba8dd1',
              'Non-Orca worktrees'
            )}
          </DialogTitle>
          <DialogDescription>{repo.displayName}</DialogDescription>
        </DialogHeader>

        <div className="flex items-center gap-3 rounded-lg border border-border bg-muted/30 p-3">
          <div className="flex size-8 shrink-0 items-center justify-center rounded-md bg-background text-muted-foreground">
            {showOther ? <Eye className="size-4" /> : <EyeOff className="size-4" />}
          </div>
          <div className="min-w-0 flex-1">
            <div className="text-sm font-medium">
              {showOther
                ? translate(
                    'auto.components.sidebar.WorktreeVisibilityDialog.3e045d4cb8',
                    'Shown in sidebar'
                  )
                : translate(
                    'auto.components.sidebar.WorktreeVisibilityDialog.5d02a5647f',
                    'Hidden from sidebar'
                  )}
            </div>
            <div className="text-xs text-muted-foreground">
              {showOther
                ? translate(
                    'auto.components.sidebar.WorktreeVisibilityDialog.8372e4bbd9',
                    '{{value0}} currently shown',
                    { value0: shownWorktreeLabel }
                  )
                : translate(
                    'auto.components.sidebar.WorktreeVisibilityDialog.25ddf19920',
                    '{{value0}} available to import',
                    { value0: hiddenWorktreeLabel }
                  )}
            </div>
          </div>
          <Button
            type="button"
            variant={showOther ? 'secondary' : 'outline'}
            onClick={handleToggle}
          >
            {showOther
              ? translate('auto.components.sidebar.WorktreeVisibilityDialog.759371df43', 'Hide')
              : translate('auto.components.sidebar.WorktreeVisibilityDialog.f1f71b9f02', 'Import')}
          </Button>
        </div>

        {listState === 'checking' ? (
          <p aria-live="polite" className="text-xs text-muted-foreground">
            {translate('auto.components.sidebar.WorktreeVisibilityDialog.a3f19c07d2', 'Checking…')}
          </p>
        ) : null}

        {listState === 'failed' ? (
          <div className="flex min-w-0 items-center gap-3" role="alert">
            <p className="min-w-0 flex-1 text-xs text-destructive">
              {translate(
                'auto.components.sidebar.WorktreeVisibilityDialog.b8d24e61f5',
                "Could not list this repo's worktrees."
              )}
            </p>
            <Button
              type="button"
              variant="outline"
              size="sm"
              disabled={busyPath !== null}
              onClick={handleRetryList}
            >
              {translate(
                'auto.components.sidebar.WorktreeVisibilityDialog.c5e70a93b1',
                'Try again'
              )}
            </Button>
          </div>
        ) : null}

        {hiddenImportable.length > 0 ? (
          <div className="grid min-w-0 gap-2">
            <div>
              <h3 className="text-sm font-medium">
                {translate(
                  'auto.components.sidebar.WorktreeVisibilityDialog.7d21c5e848',
                  'Hidden worktrees'
                )}
              </h3>
              <p className="text-xs text-muted-foreground">
                {translate(
                  'auto.components.sidebar.WorktreeVisibilityDialog.9b53f7a160',
                  'Show a single worktree without importing all of them; agent-created worktrees can only be shown here.'
                )}
              </p>
            </div>
            <ul className="scrollbar-sleek grid max-h-56 min-w-0 gap-1 overflow-y-auto">
              {hiddenImportable.map((worktree) => {
                const displayPath =
                  relativePathInsideRoot(repo.path, worktree.path) || worktree.path
                return (
                  <li
                    key={worktree.id}
                    className="flex min-w-0 items-center gap-3 rounded-md border border-border px-3 py-2"
                  >
                    <div className="min-w-0 flex-1">
                      <div className="truncate text-sm">{worktree.displayName}</div>
                      <div className="truncate text-xs text-muted-foreground">{displayPath}</div>
                    </div>
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      disabled={busyPath !== null || listState === 'checking'}
                      onClick={() => void handleShowWorktree(worktree.path)}
                    >
                      {busyPath === worktree.path
                        ? translate(
                            'auto.components.sidebar.WorktreeVisibilityDialog.2f80cd4b97',
                            'Showing…'
                          )
                        : translate(
                            'auto.components.sidebar.WorktreeVisibilityDialog.e64b81d3a9',
                            'Show'
                          )}
                    </Button>
                  </li>
                )
              })}
            </ul>
          </div>
        ) : null}

        {actionState?.error ? (
          <p className="text-xs text-destructive" role="alert">
            {actionState.error}
          </p>
        ) : null}
      </DialogContent>
    </Dialog>
  )
}
