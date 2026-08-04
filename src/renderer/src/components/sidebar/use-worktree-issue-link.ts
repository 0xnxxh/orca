import { useCallback, useMemo, useState } from 'react'
import { useAppStore } from '@/store'
import { parseGitHubIssueOrPRNumber } from '@/lib/github-links'
import { issueCacheKey as getIssueCacheKey } from '@/store/slices/github'
import { useMountedRef } from '@/hooks/useMountedRef'
import { findIndexedWorktreeOwner } from '@/lib/worktree-runtime-owner-index'
import { buildLinearIssueUrl, parseLinearIssueInput } from '../../../../shared/linear-links'
import type { IssueLinkProvider } from '../../../../shared/issue-link-input'
import type { TaskSourceContext } from '../../../../shared/task-source-context'
import { parseExplicitGitHubIssueUrl } from './worktree-meta-updates'
import { isWorkItemLinkQueryTooLarge } from '../../../../shared/new-workspace/work-item-link-query-bounds'

// Why: both lookups cross an IPC or runtime-RPC boundary that can stop
// answering — a hung SSH runtime leaves the await pending, and the button spins
// for the life of the dialog. Set above the 30s Linear/GitHub client bounds, so a
// slow-but-live transport reports its own failure rather than being called a bad
// identifier here.
const OPEN_ISSUE_TIMEOUT_MS = 35_000

async function resolveIssueUrlWithinTimeout(
  lookup: Promise<{ url?: string } | null>
): Promise<string | null> {
  let timer: ReturnType<typeof setTimeout> | undefined
  try {
    const issue = await Promise.race([
      lookup,
      new Promise<null>((resolve) => {
        timer = setTimeout(() => resolve(null), OPEN_ISSUE_TIMEOUT_MS)
      })
    ])
    return issue?.url ?? null
  } catch {
    // Why: the store's fetchers already log and normalize failures to null; a
    // rejection here is a transport fault and reads the same to the user.
    return null
  } finally {
    clearTimeout(timer)
  }
}

/** Resolves the "open linked issue" affordance for the worktree meta dialog:
 *  explicit URLs open directly, GitHub numbers resolve via the issue cache or an
 *  owner-routed fetch, Linear identifiers via the stored org key or a lookup. */
export function useWorktreeIssueLink(args: {
  worktreeId: string
  issueInput: string
  issueProvider: IssueLinkProvider
  linearOrganizationUrlKey?: string | null
  /** The persisted identifier the stored org key belongs to. */
  linkedLinearIssue?: string | null
  linearSourceContext?: TaskSourceContext | null
}): {
  canOpenIssue: boolean
  openingIssue: boolean
  /** A lookup came back empty: wrong identifier, no access, or provider offline. */
  openIssueFailed: boolean
  handleOpenIssue: () => Promise<void>
  resetOpeningIssue: () => void
} {
  const {
    worktreeId,
    issueInput,
    issueProvider,
    linearOrganizationUrlKey,
    linkedLinearIssue,
    linearSourceContext
  } = args
  const isLinear = issueProvider === 'linear'
  const fetchIssue = useAppStore((s) => s.fetchIssue)
  const fetchLinearIssue = useAppStore((s) => s.fetchLinearIssue)
  const viewerOrganizationUrlKey = useAppStore(
    (s) => s.linearStatus?.viewer?.organizationUrlKey ?? null
  )
  const [openingIssue, setOpeningIssue] = useState(false)
  const [failedIssueInput, setFailedIssueInput] = useState<string | null>(null)
  const mountedRef = useMountedRef()

  // Why: `matchGitHubItemPath` strips trailing slashes with an unanchored `/\/+$/`,
  // which is quadratic — a 160 KB paste of slashes freezes the renderer for ~19s.
  // These parses run on every keystroke, so they get the same bound the save gate
  // applies. The check short-circuits on length, so it stays O(1) on a huge paste.
  const boundedInput = useMemo(
    () => (isWorkItemLinkQueryTooLarge(issueInput) ? '' : issueInput),
    [issueInput]
  )

  const issueNumber = useMemo(
    () => (isLinear ? null : parseGitHubIssueOrPRNumber(boundedInput)),
    [isLinear, boundedInput]
  )
  const issueUrlFromInput = useMemo(
    () => (isLinear ? null : parseExplicitGitHubIssueUrl(boundedInput)),
    [isLinear, boundedInput]
  )
  const issueInputLooksLikeUrl = useMemo(
    () => /^https?:\/\//i.test(boundedInput.trim()),
    [boundedInput]
  )
  const parsedLinearIssue = useMemo(
    () => (isLinear ? parseLinearIssueInput(boundedInput) : null),
    [isLinear, boundedInput]
  )
  // Why: the input's own org key wins, then the workspace's stored one, then the
  // connected viewer's — a bare identifier is only resolvable through the latter two.
  // The stored key describes the persisted issue, so it only applies while the typed
  // identifier still *is* that issue; reusing it for a newly typed one builds a URL
  // in the wrong org and short-circuits the lookup that would have reported the miss.
  const linearIssueUrl = useMemo(() => {
    if (!parsedLinearIssue) {
      return null
    }
    const storedKeyApplies =
      typeof linkedLinearIssue === 'string' &&
      linkedLinearIssue.toUpperCase() === parsedLinearIssue.identifier.toUpperCase()
    return buildLinearIssueUrl({
      identifier: parsedLinearIssue.identifier,
      organizationUrlKey:
        parsedLinearIssue.organizationUrlKey ??
        (storedKeyApplies ? linearOrganizationUrlKey : null) ??
        viewerOrganizationUrlKey
    })
  }, [parsedLinearIssue, linkedLinearIssue, linearOrganizationUrlKey, viewerOrganizationUrlKey])

  const issueRepo = useAppStore((s) => {
    const owner = findIndexedWorktreeOwner(s.worktreesByRepo, worktreeId)
    return owner ? s.repos.find((repo) => repo.id === owner.repoId) : undefined
  })
  const cachedIssueUrl = useAppStore((s) => {
    if (!issueRepo || issueNumber === null) {
      return null
    }
    return (
      s.issueCache[
        getIssueCacheKey(
          issueRepo.path,
          issueRepo.id,
          issueNumber,
          s.settings,
          issueRepo.connectionId,
          issueRepo.executionHostId,
          true
        )
      ]?.data?.url ?? null
    )
  })
  const canOpenIssue = isLinear
    ? Boolean(parsedLinearIssue)
    : issueInputLooksLikeUrl
      ? Boolean(issueUrlFromInput)
      : Boolean(cachedIssueUrl || (issueRepo && issueNumber))

  const handleOpenIssue = useCallback(async () => {
    if (openingIssue) {
      return
    }
    setFailedIssueInput(null)

    if (isLinear) {
      if (!parsedLinearIssue) {
        return
      }
      if (linearIssueUrl) {
        void window.api.shell.openUrl(linearIssueUrl)
        return
      }

      setOpeningIssue(true)
      try {
        // Why: 'all' — the issue may belong to a different Linear workspace than
        // the selected one, which is the usual case for a pasted identifier.
        const url = await resolveIssueUrlWithinTimeout(
          fetchLinearIssue(parsedLinearIssue.identifier, 'all', {
            sourceContext: linearSourceContext ?? null
          })
        )
        if (url) {
          void window.api.shell.openUrl(url)
        } else if (mountedRef.current) {
          // Why: the fetchers normalize every failure — no Linear connection,
          // unknown identifier, dead runtime — to null, so without this the
          // button just stops spinning and the click looks ignored.
          setFailedIssueInput(issueInput)
        }
      } finally {
        if (mountedRef.current) {
          setOpeningIssue(false)
        }
      }
      return
    }

    if (issueUrlFromInput) {
      void window.api.shell.openUrl(issueUrlFromInput)
      return
    }

    if (issueInputLooksLikeUrl) {
      return
    }

    if (cachedIssueUrl) {
      void window.api.shell.openUrl(cachedIssueUrl)
      return
    }

    if (!issueRepo || issueNumber === null) {
      return
    }

    setOpeningIssue(true)
    try {
      const url = await resolveIssueUrlWithinTimeout(
        fetchIssue(issueRepo.path, issueNumber, { repoId: issueRepo.id })
      )
      if (url) {
        void window.api.shell.openUrl(url)
      } else if (mountedRef.current) {
        setFailedIssueInput(issueInput)
      }
    } finally {
      if (mountedRef.current) {
        setOpeningIssue(false)
      }
    }
  }, [
    cachedIssueUrl,
    fetchIssue,
    fetchLinearIssue,
    isLinear,
    issueInput,
    issueInputLooksLikeUrl,
    issueNumber,
    issueRepo,
    issueUrlFromInput,
    linearIssueUrl,
    linearSourceContext,
    mountedRef,
    openingIssue,
    parsedLinearIssue
  ])

  const resetOpeningIssue = useCallback(() => {
    setOpeningIssue(false)
    setFailedIssueInput(null)
  }, [])

  return {
    canOpenIssue,
    openingIssue,
    // Why: the failure belongs to the value that produced it. Editing the field
    // is the user's answer to it, so comparing rather than clearing on change
    // retires the notice without an Effect that would lag a keystroke behind.
    openIssueFailed: failedIssueInput !== null && failedIssueInput === issueInput,
    handleOpenIssue,
    resetOpeningIssue
  }
}
