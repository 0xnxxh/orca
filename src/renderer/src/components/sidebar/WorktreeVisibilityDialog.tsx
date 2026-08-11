import React, { useCallback, useEffect, useId, useLayoutEffect, useRef, useState } from 'react'
import { Eye, EyeOff } from 'lucide-react'
import { useVirtualizer } from '@tanstack/react-virtual'
import { useAppStore } from '@/store'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle
} from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { Label } from '@/components/ui/label'
import { Switch } from '@/components/ui/switch'
import {
  getHiddenImportableExternalWorktrees,
  getVisibleNonOrcaWorktrees
} from '../../../../shared/external-worktree-inbox'
import { isGitRepoKind } from '../../../../shared/repo-kind'
import { relativePathInsideRoot } from '../../../../shared/cross-platform-path'
import {
  effectiveAgentWorktreeVisibility,
  effectiveExternalWorktreeVisibility,
  isLegacyRepoForExternalWorktreeVisibility
} from '../../../../shared/worktree-ownership'
import { translate } from '@/i18n/i18n'
import {
  importNewExternalWorktreeInboxPaths,
  type NewExternalWorktreesInboxActionState
} from './new-external-worktrees-inbox-actions'
import WorktreeVisibilityHelpPopover from './WorktreeVisibilityHelpPopover'
import {
  finishVisibilityMutation,
  getActiveVisibilityMutation,
  startVisibilityMutation,
  subscribeToVisibilityMutation,
  type ActiveVisibilityMutation
} from './worktree-visibility-mutation-fence'

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
  const [isToggling, setIsToggling] = useState(false)
  const [listState, setListState] = useState<'checking' | 'ready' | 'failed'>('checking')
  const alwaysShowSwitchId = useId()
  const hiddenListHeadingId = useId()
  const hiddenListRef = useRef<HTMLDivElement>(null)

  const isOpen = activeModal === 'worktree-visibility'
  const repoId = typeof modalData.repoId === 'string' ? modalData.repoId : ''
  const currentRepoIdRef = useRef(repoId)
  const activeMutation = getActiveVisibilityMutation(repoId)
  const effectiveBusyPath =
    busyPath ?? (activeMutation?.kind === 'row' ? activeMutation.path : null)
  const effectivelyToggling = isToggling || activeMutation?.kind === 'toggle'
  const repo = repos.find((candidate) => candidate.id === repoId) ?? null
  const detected = repoId ? detectedWorktreesByRepo[repoId] : undefined
  const showOther = repo
    ? effectiveExternalWorktreeVisibility(repo, isLegacyRepoForExternalWorktreeVisibility(repo)) ===
      'show'
    : false
  const showAgentScratch = repo ? effectiveAgentWorktreeVisibility(repo) === 'show' : false
  const alwaysShow = showOther && showAgentScratch
  const hiddenImportable = getHiddenImportableExternalWorktrees(detected)
  const hiddenCount = hiddenImportable.length
  const otherCount = getVisibleNonOrcaWorktrees(detected).length
  const hiddenWorktreeLabel = `${hiddenCount} ${hiddenCount === 1 ? 'worktree' : 'worktrees'}`
  const shownWorktreeLabel = `${otherCount} ${otherCount === 1 ? 'worktree' : 'worktrees'}`
  const hiddenListVirtualizer = useVirtualizer({
    count: hiddenImportable.length,
    getScrollElement: () => hiddenListRef.current,
    estimateSize: () => 56,
    getItemKey: (index) => hiddenImportable[index]?.id ?? index,
    overscan: 3,
    initialRect: { width: 480, height: 224 }
  })

  useLayoutEffect(() => {
    currentRepoIdRef.current = repoId
  }, [repoId])

  useEffect(() => {
    const activeMutation = getActiveVisibilityMutation(repoId)
    setActionState(null)
    setBusyPath(activeMutation?.kind === 'row' ? activeMutation.path : null)
    setIsToggling(activeMutation?.kind === 'toggle')
    if (!activeMutation) {
      return
    }
    let cancelled = false
    const unsubscribe = subscribeToVisibilityMutation(repoId, () => {
      void fetchWorktrees(repoId, { requireAuthoritative: true }).then((refreshed) => {
        if (!cancelled && currentRepoIdRef.current === repoId) {
          setListState(refreshed ? 'ready' : 'failed')
          setBusyPath(null)
          setIsToggling(false)
        }
      })
    })
    return () => {
      cancelled = true
      unsubscribe()
    }
  }, [fetchWorktrees, repoId])

  // Why: recovery must not trust a stale or fallback snapshot — an empty one
  // would read as "nothing hidden" for a worktree that is sitting on disk (#10324).
  useEffect(() => {
    if (!isOpen || !repoId) {
      return
    }
    // Why: reopening mid-write must not start a scan that can absorb the mutation's confirmation refresh.
    if (getActiveVisibilityMutation(repoId)) {
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
    if (currentRepoIdRef.current === repoId) {
      setListState(refreshed ? 'ready' : 'failed')
    }
  }, [fetchWorktrees, repoId])

  const handleShowWorktree = useCallback(
    async (worktreePath: string) => {
      if (!repo) {
        return
      }
      const mutation: ActiveVisibilityMutation = { kind: 'row', path: worktreePath }
      startVisibilityMutation(repo.id, mutation)
      setBusyPath(worktreePath)
      try {
        await importNewExternalWorktreeInboxPaths({
          projectId: repo.id,
          repo,
          worktreePaths: [worktreePath],
          updateRepo,
          fetchWorktrees,
          setInboxState: (_projectId, state) => {
            if (currentRepoIdRef.current !== repo.id) {
              return
            }
            setActionState(state)
            // Why: a null state is only reachable after a successful authoritative
            // refetch, which supersedes an earlier failed open-time scan.
            if (state === null) {
              setListState('ready')
            }
          }
        })
      } finally {
        finishVisibilityMutation(repo.id, mutation)
        if (currentRepoIdRef.current === repo.id) {
          setBusyPath(null)
        }
      }
    },
    [fetchWorktrees, repo, updateRepo]
  )

  const handleAlwaysShowChange = useCallback(
    async (checked: boolean) => {
      if (!repoId || checked === alwaysShow) {
        return
      }
      const mutation: ActiveVisibilityMutation = { kind: 'toggle' }
      startVisibilityMutation(repoId, mutation)
      setActionState(null)
      setIsToggling(true)
      try {
        const updated = await updateRepo(repoId, {
          externalWorktreeVisibility: checked ? 'show' : 'hide',
          agentWorktreeVisibility: checked ? 'show' : 'hide',
          // Why: showing hidden externals again should re-enable the inbox if the
          // user previously opted out of discovery prompts for this repo.
          // Why: null is the transport sentinel for clearing on remote runtime paths
          // where `undefined` is stripped before persistence.
          ...(checked ? { externalWorktreeDiscoverySuppressedAt: null } : {})
        })
        if (!updated) {
          if (currentRepoIdRef.current === repoId) {
            setActionState({
              pending: false,
              error: translate(
                'auto.components.sidebar.WorktreeVisibilityDialog.d40d436fc2',
                'Could not update worktree visibility. Try again.'
              )
            })
          }
          return
        }
        const refreshed = await fetchWorktrees(repoId, { requireAuthoritative: true })
        if (currentRepoIdRef.current === repoId) {
          setListState(refreshed ? 'ready' : 'failed')
        }
      } finally {
        finishVisibilityMutation(repoId, mutation)
        if (currentRepoIdRef.current === repoId) {
          setIsToggling(false)
        }
      }
    },
    [alwaysShow, fetchWorktrees, repoId, updateRepo]
  )

  if (!isOpen || !repo || !isGitRepoKind(repo)) {
    return null
  }

  return (
    <Dialog open onOpenChange={(open) => !open && closeModal()}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <div className="flex items-center gap-1.5">
            <DialogTitle>
              {translate(
                'auto.components.sidebar.WorktreeVisibilityDialog.83a5ba8dd1',
                'Non-Orca worktrees'
              )}
            </DialogTitle>
            <WorktreeVisibilityHelpPopover />
          </div>
          <DialogDescription>{repo.displayName}</DialogDescription>
        </DialogHeader>

        <div className="flex items-center gap-3 rounded-lg border border-border bg-muted/30 p-3">
          <div className="flex size-8 shrink-0 items-center justify-center rounded-md bg-background text-muted-foreground">
            {alwaysShow ? <Eye className="size-4" /> : <EyeOff className="size-4" />}
          </div>
          <div className="min-w-0 flex-1">
            <div className="text-sm font-medium">
              {alwaysShow
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
              {alwaysShow
                ? translate(
                    'auto.components.sidebar.WorktreeVisibilityDialog.8372e4bbd9',
                    '{{value0}} currently shown',
                    { value0: shownWorktreeLabel }
                  )
                : translate(
                    'auto.components.sidebar.WorktreeVisibilityDialog.25ddf19920',
                    '{{value0}} currently hidden',
                    { value0: hiddenWorktreeLabel }
                  )}
            </div>
          </div>
          <Label htmlFor={alwaysShowSwitchId} className="shrink-0 gap-2">
            {translate(
              'auto.components.sidebar.WorktreeVisibilityDialog.f1f71b9f02',
              'Always show'
            )}
            <Switch
              id={alwaysShowSwitchId}
              checked={alwaysShow}
              disabled={
                effectiveBusyPath !== null || effectivelyToggling || listState === 'checking'
              }
              onCheckedChange={(checked) => void handleAlwaysShowChange(checked)}
            />
          </Label>
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
              disabled={effectiveBusyPath !== null || effectivelyToggling}
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
              <h3 id={hiddenListHeadingId} className="text-sm font-medium">
                {translate(
                  'auto.components.sidebar.WorktreeVisibilityDialog.7d21c5e848',
                  'Hidden worktrees ({{value0}})',
                  { value0: hiddenImportable.length }
                )}
              </h3>
              <p className="text-xs text-muted-foreground">
                {translate(
                  'auto.components.sidebar.WorktreeVisibilityDialog.9b53f7a160',
                  'Choose which hidden worktrees to show individually.'
                )}
              </p>
            </div>
            <div
              ref={hiddenListRef}
              aria-labelledby={hiddenListHeadingId}
              className="scrollbar-sleek max-h-56 min-w-0 overflow-y-auto"
              tabIndex={0}
              style={{
                height: `${Math.min(hiddenListVirtualizer.getTotalSize(), 224)}px`
              }}
            >
              <ul
                className="relative min-w-0"
                style={{ height: `${hiddenListVirtualizer.getTotalSize()}px` }}
              >
                {hiddenListVirtualizer.getVirtualItems().map((virtualRow) => {
                  const worktree = hiddenImportable[virtualRow.index]
                  if (!worktree) {
                    return null
                  }
                  const displayPath =
                    relativePathInsideRoot(repo.path, worktree.path) || worktree.path
                  return (
                    <li
                      key={worktree.id}
                      ref={hiddenListVirtualizer.measureElement}
                      data-index={virtualRow.index}
                      className="absolute left-0 top-0 w-full pb-1"
                      style={{ transform: `translateY(${virtualRow.start}px)` }}
                      aria-posinset={virtualRow.index + 1}
                      aria-setsize={hiddenImportable.length}
                    >
                      <div className="flex min-w-0 items-center gap-3 rounded-md border border-border px-3 py-2">
                        <div className="min-w-0 flex-1">
                          <div className="truncate text-sm">{worktree.displayName}</div>
                          <div className="truncate text-xs text-muted-foreground">
                            {displayPath}
                          </div>
                        </div>
                        <Button
                          type="button"
                          variant="outline"
                          size="sm"
                          disabled={
                            effectiveBusyPath !== null ||
                            effectivelyToggling ||
                            listState === 'checking'
                          }
                          onClick={() => void handleShowWorktree(worktree.path)}
                        >
                          {effectiveBusyPath === worktree.path
                            ? translate(
                                'auto.components.sidebar.WorktreeVisibilityDialog.2f80cd4b97',
                                'Showing…'
                              )
                            : translate(
                                'auto.components.sidebar.WorktreeVisibilityDialog.e64b81d3a9',
                                'Show'
                              )}
                        </Button>
                      </div>
                    </li>
                  )
                })}
              </ul>
            </div>
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
