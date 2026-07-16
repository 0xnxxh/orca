import { useCallback, useEffect, useState } from 'react'
import { toast } from 'sonner'
import type { ParsedTaskQuery } from '../../../shared/task-query'
import type { GitHubWorkItem } from '../../../shared/types'
import {
  getTaskSourceRuntimeSettings,
  type TaskSourceContext
} from '../../../shared/task-source-context'
import { getActiveRuntimeTarget } from '@/runtime/runtime-rpc-client'
import { useAppStore } from '@/store'
import {
  beginTaskPageGitHubWorkItemMutation,
  confirmTaskPageGitHubWorkItemMutation,
  isTaskPageGitHubMutationPendingKey,
  rollbackTaskPageGitHubWorkItemMutation
} from '@/components/task-page-github-work-item-mutations'
import type { TaskPageGitHubMutationIntent } from '@/components/task-page-github-work-item-mutation-patches'
import {
  getTaskPageGitHubSoftHiddenItemKeys,
  subscribeTaskPageGitHubMutationRegistry,
  setTaskPageGitHubMutationQueryKey,
  type TaskPageGitHubMutationKey
} from '@/components/task-page-github-work-item-mutation-registry'
import { useMountedRef } from './useMountedRef'

export type UseTaskPageGitHubWorkItemMutationArgs = {
  appliedTaskSearch: string
  queryKey: string
  query: ParsedTaskQuery
  /** Local gh viewer login only; may be null. */
  viewerLogin: string | null
  /**
   * Bumps quietRefreshNonce (or equivalent) only — must not set tasksFiltering /
   * must not use taskRefreshNonce (K23). When provided, also registers with
   * the mutations quiet scheduler via scheduleTaskPageQuietRevalidate.
   */
  scheduleQuietRevalidate: () => void
}

function deriveSkipMeQualifiers(sourceContext?: TaskSourceContext | null): boolean {
  if (!sourceContext) {
    return false
  }
  const settings = getTaskSourceRuntimeSettings(sourceContext)
  const target = getActiveRuntimeTarget(settings)
  // Why: local gh viewer must not evaluate @me soft-hide for SSH/environment rows.
  return target.kind === 'environment'
}

export function useTaskPageGitHubWorkItemMutation(args: UseTaskPageGitHubWorkItemMutationArgs): {
  run: (input: {
    item: GitHubWorkItem
    intent: TaskPageGitHubMutationIntent
    sourceContext?: TaskSourceContext | null
    mutate: () => Promise<{ ok?: boolean; error?: string | { message?: string } } | void>
    successToast?: string
    errorToast: string
    serverEntityFromResult?: (result: unknown) => Partial<GitHubWorkItem> | undefined
  }) => Promise<'confirmed' | 'rolled_back' | 'stale'>
  isPending: (key: TaskPageGitHubMutationKey) => boolean
  softHiddenItemKeys: ReadonlySet<string>
} {
  const patchWorkItem = useAppStore((s) => s.patchWorkItem)
  const mountedRef = useMountedRef()
  const [softHiddenItemKeys, setSoftHiddenItemKeys] = useState<ReadonlySet<string>>(
    () => new Set(getTaskPageGitHubSoftHiddenItemKeys())
  )

  useEffect(() => {
    setTaskPageGitHubMutationQueryKey(args.queryKey)
  }, [args.queryKey])

  useEffect(() => {
    setSoftHiddenItemKeys(new Set(getTaskPageGitHubSoftHiddenItemKeys()))
    return subscribeTaskPageGitHubMutationRegistry(() => {
      setSoftHiddenItemKeys(new Set(getTaskPageGitHubSoftHiddenItemKeys()))
    })
  }, [])

  const isPending = useCallback((key: TaskPageGitHubMutationKey) => {
    return isTaskPageGitHubMutationPendingKey(key)
  }, [])

  const { query, queryKey, viewerLogin, scheduleQuietRevalidate } = args

  const run = useCallback(
    async (input: {
      item: GitHubWorkItem
      intent: TaskPageGitHubMutationIntent
      sourceContext?: TaskSourceContext | null
      mutate: () => Promise<{ ok?: boolean; error?: string | { message?: string } } | void>
      successToast?: string
      errorToast: string
      serverEntityFromResult?: (result: unknown) => Partial<GitHubWorkItem> | undefined
    }): Promise<'confirmed' | 'rolled_back' | 'stale'> => {
      const skipMeQualifiers = deriveSkipMeQualifiers(input.sourceContext)
      const began = beginTaskPageGitHubWorkItemMutation({
        item: input.item,
        intent: input.intent,
        sourceContext: input.sourceContext,
        query,
        queryKey,
        viewerLogin,
        skipMeQualifiers,
        patchWorkItem
      })

      try {
        const result = await input.mutate()
        const typed = result as { ok?: boolean; error?: string | { message?: string } } | void
        if (typed && typeof typed === 'object' && typed.ok === false) {
          const rolled = rollbackTaskPageGitHubWorkItemMutation({
            key: began.key,
            generation: began.generation,
            patchWorkItem,
            sourceContext: input.sourceContext,
            query,
            queryKey,
            viewerLogin,
            item: input.item
          })
          if (rolled === 'rolled_back' && mountedRef.current) {
            const message =
              typeof typed.error === 'string'
                ? typed.error
                : (typed.error?.message ?? input.errorToast)
            toast.error(message)
          }
          return rolled
        }

        const serverEntity = input.serverEntityFromResult?.(result)
        const confirmed = confirmTaskPageGitHubWorkItemMutation(began.key, began.generation, {
          query,
          queryKey,
          viewerLogin,
          item: input.item,
          serverEntity,
          patchWorkItem,
          sourceContext: input.sourceContext,
          // Quiet revalidate: mark dirty; TaskPage runner is registered separately.
          scheduleQuiet: false
        })
        if (confirmed === 'confirmed') {
          // Why: TaskPage owns the quiet fetch (K23); confirm already marked dirty.
          scheduleQuietRevalidate()
          if (input.successToast && mountedRef.current) {
            toast.success(input.successToast)
          }
          useAppStore.getState().recordFeatureInteraction('github-tasks')
        }
        return confirmed
      } catch (err) {
        const rolled = rollbackTaskPageGitHubWorkItemMutation({
          key: began.key,
          generation: began.generation,
          patchWorkItem,
          sourceContext: input.sourceContext,
          query,
          queryKey,
          viewerLogin,
          item: input.item
        })
        if (rolled === 'rolled_back' && mountedRef.current) {
          toast.error(err instanceof Error ? err.message : input.errorToast)
        }
        return rolled
      }
    },
    [query, queryKey, viewerLogin, scheduleQuietRevalidate, mountedRef, patchWorkItem]
  )

  return { run, isPending, softHiddenItemKeys }
}
