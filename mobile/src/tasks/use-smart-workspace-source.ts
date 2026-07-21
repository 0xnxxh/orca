import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { GitHubWorkItem, GitLabWorkItem, LinearIssue } from '../../../src/shared/types'
import { findLinearIssueExactReferenceMatch } from '../../../src/shared/linear-links'
import {
  buildSmartWorkspaceSourceRows,
  getSmartWorkspaceEmptyHint,
  type SmartNameMode,
  type SmartWorkspaceSourceRow
} from '../../../src/shared/new-workspace/smart-workspace-source-results'
import type { RpcClient } from '../transport/rpc-client'
import { fanOutSmartSearch, type SmartFanOutResult } from './smart-source-fan-out'
import type { MrStateFilter } from './mobile-composer-source-types'
import {
  findRepoMatchingSlugForPaste,
  lookupGitHubItemByNumber,
  lookupGitHubItemByOwnerRepo,
  lookupGitLabItemByPath,
  resolvePasteIntent,
  type PasteRepoCandidate
} from './smart-source-paste-intent'
import { getLinearIssuesByIdentifier } from './smart-source-search-requests'

const DEBOUNCE_MS = 200
const RESULT_LIMIT = 36

export type SmartCrossRepoPrompt = {
  link: { slug: { owner: string; repo: string }; number: number; type: 'issue' | 'pr' }
  matchingRepo: PasteRepoCandidate
}

export type UseSmartWorkspaceSourceArgs = {
  client: RpcClient | null
  enabled: boolean
  mode: SmartNameMode
  query: string
  repoId: string | null
  githubAvailable: boolean
  gitlabAvailable: boolean
  linearAvailable: boolean
  mrStateFilter: MrStateFilter
  linearWorkspaceId?: string | null
  repos: readonly PasteRepoCandidate[]
}

const EMPTY_FAN: SmartFanOutResult = {
  githubItems: [],
  gitlabItems: [],
  linearIssues: [],
  branches: [],
  needsGitHubRemote: false,
  error: ''
}

type PasteResolved = {
  github: GitHubWorkItem | null
  gitlab: GitLabWorkItem | null
  linear: LinearIssue | null
}

export type SmartLinearLinkResolution =
  | { status: 'idle' }
  | { status: 'resolving' }
  | { status: 'resolved'; identifier: string }
  | { status: 'not-found' }

const IDLE_LINEAR_LINK_RESOLUTION: SmartLinearLinkResolution = { status: 'idle' }

export function useSmartWorkspaceSource(args: UseSmartWorkspaceSourceArgs) {
  const {
    client,
    enabled,
    mode,
    query,
    repoId,
    githubAvailable,
    gitlabAvailable,
    linearAvailable,
    mrStateFilter,
    linearWorkspaceId,
    repos
  } = args
  const [fan, setFan] = useState<SmartFanOutResult>(EMPTY_FAN)
  const [paste, setPaste] = useState<PasteResolved>({ github: null, gitlab: null, linear: null })
  const [linearLinkResolution, setLinearLinkResolution] = useState<SmartLinearLinkResolution>(
    IDLE_LINEAR_LINK_RESOLUTION
  )
  const [loading, setLoading] = useState(false)
  const [crossRepoPrompt, setCrossRepoPrompt] = useState<SmartCrossRepoPrompt | null>(null)
  // Why: preserve results across keystrokes (debounce) but drop them the moment
  // the mode/repo changes so one provider's rows never render under another tab.
  const scopeRef = useRef('')
  const dismissedPasteRef = useRef<string>('')
  const repoSlugCacheRef = useRef<Map<string, { owner: string; repo: string } | null>>(new Map())

  useEffect(() => {
    if (!client || !enabled || mode === 'text') {
      setFan(EMPTY_FAN)
      setPaste({ github: null, gitlab: null, linear: null })
      setLinearLinkResolution(IDLE_LINEAR_LINK_RESOLUTION)
      setLoading(false)
      setCrossRepoPrompt(null)
      return
    }
    const scope = `${mode}:${repoId ?? ''}`
    const scopeChanged = scopeRef.current !== scope
    scopeRef.current = scope
    if (scopeChanged) {
      setFan(EMPTY_FAN)
      setPaste({ github: null, gitlab: null, linear: null })
      setCrossRepoPrompt(null)
    }
    const pendingIntent = mode === 'branches' ? null : resolvePasteIntent(query)
    const shouldResolveLinearLink = linearAvailable && (mode === 'smart' || mode === 'linear')
    setLinearLinkResolution(
      pendingIntent?.kind === 'linear-link' && shouldResolveLinearLink
        ? { status: 'resolving' }
        : IDLE_LINEAR_LINK_RESOLUTION
    )
    setLoading(true)
    let stale = false
    const timer = setTimeout(() => {
      void runSmartSearch({
        client,
        mode,
        query,
        repoId,
        githubAvailable,
        gitlabAvailable,
        linearAvailable,
        mrStateFilter,
        linearWorkspaceId,
        repos,
        dismissedPasteRef,
        repoSlugCache: repoSlugCacheRef.current
      })
        .then((result) => {
          if (stale) {
            return
          }
          setFan(result.fan)
          setPaste(result.paste)
          setLinearLinkResolution(result.linearLinkResolution)
          setCrossRepoPrompt(result.crossRepoPrompt)
          setLoading(false)
        })
        .catch(() => {
          if (!stale) {
            setLinearLinkResolution(IDLE_LINEAR_LINK_RESOLUTION)
            setLoading(false)
          }
        })
    }, DEBOUNCE_MS)
    return () => {
      stale = true
      clearTimeout(timer)
    }
  }, [
    client,
    enabled,
    mode,
    query,
    repoId,
    githubAvailable,
    gitlabAvailable,
    linearAvailable,
    mrStateFilter,
    linearWorkspaceId,
    repos
  ])

  const rows = useMemo<SmartWorkspaceSourceRow[]>(
    () =>
      buildSmartWorkspaceSourceRows({
        branches: fan.branches,
        githubItems: paste.github ? [paste.github] : fan.githubItems,
        gitlabAvailable,
        gitlabItems: paste.gitlab ? [paste.gitlab] : fan.gitlabItems,
        linearAvailable,
        linearIssues: paste.linear
          ? [
              paste.linear,
              ...fan.linearIssues.filter(
                (issue) =>
                  issue.id !== paste.linear?.id || issue.workspaceId !== paste.linear.workspaceId
              )
            ]
          : fan.linearIssues,
        mode,
        resultLimit: RESULT_LIMIT,
        value: query
      }),
    [fan, gitlabAvailable, linearAvailable, mode, paste, query]
  )

  const dismissCrossRepoPrompt = useCallback(() => {
    dismissedPasteRef.current = query.trim()
    setCrossRepoPrompt(null)
  }, [query])

  return {
    rows,
    loading,
    error: fan.error,
    needsGitHubRemote: fan.needsGitHubRemote,
    emptyHint: getSmartWorkspaceEmptyHint(mode),
    crossRepoPrompt,
    dismissCrossRepoPrompt,
    linearLinkResolution
  }
}

export async function runSmartSearch(args: {
  client: RpcClient
  mode: SmartNameMode
  query: string
  repoId: string | null
  githubAvailable: boolean
  gitlabAvailable: boolean
  linearAvailable: boolean
  mrStateFilter: MrStateFilter
  linearWorkspaceId: string | null | undefined
  repos: readonly PasteRepoCandidate[]
  dismissedPasteRef: { current: string }
  repoSlugCache: Map<string, { owner: string; repo: string } | null>
}): Promise<{
  fan: SmartFanOutResult
  paste: PasteResolved
  crossRepoPrompt: SmartCrossRepoPrompt | null
  linearLinkResolution: SmartLinearLinkResolution
}> {
  const { client, mode, query, repoId, repos, dismissedPasteRef, repoSlugCache } = args
  const intent =
    mode === 'branches' || dismissedPasteRef.current === query.trim()
      ? null
      : resolvePasteIntent(query)
  const effectiveIntent =
    intent?.kind === 'linear-link' &&
    (!args.linearAvailable || (mode !== 'smart' && mode !== 'linear'))
      ? null
      : intent
  const fan = await fanOutSmartSearch({
    ...args,
    ...(effectiveIntent?.kind === 'linear-link'
      ? { linearQuery: effectiveIntent.reference.identifier }
      : {})
  })
  const paste: PasteResolved = { github: null, gitlab: null, linear: null }
  let crossRepoPrompt: SmartCrossRepoPrompt | null = null
  let linearLinkResolution: SmartLinearLinkResolution = IDLE_LINEAR_LINK_RESOLUTION

  if (effectiveIntent?.kind === 'linear-link') {
    const searchExactIssue = findLinearIssueExactReferenceMatch(
      fan.linearIssues,
      effectiveIntent.reference
    )
    if (searchExactIssue) {
      paste.linear = searchExactIssue
      linearLinkResolution = {
        status: 'resolved',
        identifier: searchExactIssue.identifier
      }
    } else {
      try {
        const result = await getLinearIssuesByIdentifier(
          client,
          effectiveIntent.reference.identifier
        )
        const exactIssue = findLinearIssueExactReferenceMatch(
          result.items,
          effectiveIntent.reference
        )
        if (exactIssue) {
          paste.linear = exactIssue
          linearLinkResolution = { status: 'resolved', identifier: exactIssue.identifier }
        } else if ((result.errors?.length ?? 0) === 0) {
          linearLinkResolution = { status: 'not-found' }
        }
      } catch {
        // Best-effort exact lookup: an RPC failure is transient, not a miss.
      }
    }
    // Why: URL resolution failures fall through silently even in Linear-only
    // mode; the exact lookup envelope decides whether a not-found cue is safe.
    fan.error = ''
  } else if (effectiveIntent && repoId) {
    try {
      if (effectiveIntent.kind === 'github-number') {
        paste.github = await lookupGitHubItemByNumber(client, repoId, effectiveIntent.number)
      } else if (effectiveIntent.kind === 'github-link') {
        const matchingRepo = await findRepoMatchingSlugForPaste(
          client,
          repos,
          effectiveIntent.link.slug,
          repoSlugCache
        )
        if (matchingRepo && matchingRepo.id !== repoId) {
          crossRepoPrompt = { link: effectiveIntent.link, matchingRepo }
        } else {
          paste.github = await lookupGitHubItemByOwnerRepo(
            client,
            repoId,
            effectiveIntent.link.slug,
            effectiveIntent.link.number,
            effectiveIntent.link.type
          )
        }
      } else if (effectiveIntent.kind === 'gitlab-link') {
        paste.gitlab = await lookupGitLabItemByPath(client, repoId, effectiveIntent.link)
      }
    } catch {
      // Best-effort paste resolution; fall back to the fan-out results.
    }
  }
  return { fan, paste, crossRepoPrompt, linearLinkResolution }
}
