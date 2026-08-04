import { parseGitHubIssueOrPRLink, parseGitHubIssueOrPRNumber } from '@/lib/github-links'
import {
  buildLinearIssueLinkUpdates,
  LINEAR_ISSUE_LINK_CLEARED
} from '../../../../shared/linear-links'
import { parseIssueLinkInput, type IssueLinkProvider } from '../../../../shared/issue-link-input'
import type { WorkspaceSourceProvider } from '../../../../shared/new-workspace/workspace-source'
import type { WorkspaceLinkedItem, WorktreeMeta } from '../../../../shared/types'

export type WorktreeMetaSavedPayload = {
  worktreeId: string
  updates: Partial<WorktreeMeta>
}

/** What the user currently has typed in the dialog. */
export type WorktreeMetaDraft = {
  displayNameInput: string
  issueInput: string
  issueProvider: IssueLinkProvider
  prInput: string
  commentInput: string
}

/** The persisted state the dialog was seeded from. Captured once when the
 *  dialog opens: comparing a frozen draft against a live store would let a
 *  background write move the baseline and make an untouched field "dirty". */
export type WorktreeMetaSnapshot = {
  displayName: string
  issueInput: string
  issueProvider: IssueLinkProvider
  linkedWorkItemProvider?: WorkspaceSourceProvider | null
  /** `linkedWorkItem` also describes PRs and MRs, which this row does not own. */
  linkedWorkItemType?: WorkspaceLinkedItem['type'] | null
}

export function parseExplicitGitHubIssueUrl(input: string): string | null {
  const trimmed = input.trim()
  const link = parseGitHubIssueOrPRLink(trimmed)
  if (!link || link.type !== 'issue') {
    return null
  }

  return trimmed
}

export function parseGitHubWorkItemNumberForMetaField(
  input: string,
  expectedType: 'issue' | 'pr'
): number | null {
  const link = parseGitHubIssueOrPRLink(input)
  if (link) {
    // Why: issue and PR numbers live in separate GitHub namespaces for refs;
    // a URL path mismatch must not silently link the other field.
    return link.type === expectedType ? link.number : null
  }

  return parseGitHubIssueOrPRNumber(input)
}

// Why: blanking the field means "fall back to the branch/folder name", and the
// empty string is how that intent is persisted. Emitting `undefined` instead
// put a present-but-undefined key into the store spread, wiping the live name
// and crashing the worktree palette (crash a1f81ea1).
function buildDisplayNameUpdate(
  draft: WorktreeMetaDraft,
  current: WorktreeMetaSnapshot
): Partial<WorktreeMeta> {
  const trimmed = draft.displayNameInput.trim()
  return trimmed === current.displayName ? {} : { displayName: trimmed }
}

export function isIssueFieldDirty(
  draft: WorktreeMetaDraft,
  current: WorktreeMetaSnapshot
): boolean {
  if (draft.issueInput.trim() !== current.issueInput.trim()) {
    return true
  }
  // Why: a provider switch only means something when there is a value to
  // reinterpret. Toggling the chip on an empty field states no intent, and
  // treating it as dirty would turn a comment-only save into a link wipe.
  return draft.issueProvider !== current.issueProvider && draft.issueInput.trim() !== ''
}

/** Owns both provider slot families. One issue per workspace: writing one
 *  provider clears the other. Emits nothing at all unless the field changed —
 *  the dialog opens focused on Comment, so an untouched field must never
 *  destroy a link the user came here to keep. */
function buildIssueLinkUpdates(
  draft: WorktreeMetaDraft,
  current: WorktreeMetaSnapshot
): Partial<WorktreeMeta> {
  if (!isIssueFieldDirty(draft, current)) {
    return {}
  }

  const trimmed = draft.issueInput.trim()
  // Why: the linked work item and its source context describe the issue being
  // replaced. Leaving them would keep a stale title badge and mis-scope Linear
  // reads. Narrow on purpose: `type` because the field also records the PR or MR
  // a workspace was created from, and provider because GitLab and Jira issues
  // have no slot in this row — displacing what it cannot display would destroy a
  // link the user was never shown and has no other editor to restore it from.
  const displacedWorkItem: Partial<WorktreeMeta> =
    (current.linkedWorkItemProvider === 'github' || current.linkedWorkItemProvider === 'linear') &&
    current.linkedWorkItemType === 'issue'
      ? { linkedWorkItem: null, linkedTaskSourceContext: null }
      : {}

  if (trimmed === '') {
    return {
      linkedIssue: null,
      ...LINEAR_ISSUE_LINK_CLEARED,
      ...displacedWorkItem
    }
  }

  const parsed = parseIssueLinkInput(trimmed, draft.issueProvider)
  if (!parsed) {
    // Why: unparseable input leaves every link untouched. `canSave` already
    // blocks this path, but the builder stays pure rather than relying on it.
    return {}
  }

  if (parsed.provider === 'github') {
    return {
      linkedIssue: parsed.number,
      ...LINEAR_ISSUE_LINK_CLEARED,
      ...displacedWorkItem
    }
  }

  const linearUpdates = buildLinearIssueLinkUpdates(trimmed)
  return linearUpdates ? { linkedIssue: null, ...linearUpdates, ...displacedWorkItem } : {}
}

function buildPrLinkUpdate(draft: WorktreeMetaDraft): Partial<WorktreeMeta> {
  const trimmed = draft.prInput.trim()
  if (trimmed === '') {
    return { linkedPR: null }
  }
  const number = parseGitHubWorkItemNumberForMetaField(trimmed, 'pr')
  return number === null ? {} : { linkedPR: number }
}

/** Pure save-payload builder for the worktree meta dialog: empty inputs clear
 *  the link (null), unparseable inputs leave it untouched (omitted). No key is
 *  ever emitted holding `undefined` — persistence raw-spreads updates, so a
 *  present-but-undefined key erases the stored value. */
export function buildWorktreeMetaUpdates(
  draft: WorktreeMetaDraft,
  current: WorktreeMetaSnapshot
): Partial<WorktreeMeta> {
  return {
    comment: draft.commentInput.trim(),
    ...buildDisplayNameUpdate(draft, current),
    ...buildIssueLinkUpdates(draft, current),
    ...buildPrLinkUpdate(draft)
  }
}
