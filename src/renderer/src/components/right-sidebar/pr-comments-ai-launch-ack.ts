import type { PRComment } from '../../../../shared/types'
import { getPRCommentGroupRoot, type PRCommentGroup } from '@/lib/pr-comment-groups'
import { isResolvablePRCommentGroup } from '../pr-comments-resolution-prompt'

/** Posted when a selected review comment is sent to AI. */
export const PR_COMMENT_AI_FIXING_REPLY = 'Fixing. Will be in the next commit'

export type PRCommentAiLaunchAckCounts = {
  resolved: number
  replied: number
  skipped: number
  failed: number
}

export type PRCommentAiLaunchAckDeps = {
  isStillCurrent: () => boolean
  /** True when the thread is still open and host-resolvable in live comment state. */
  isThreadStillResolvable: (threadId: string) => boolean
  resolveThread: (threadId: string) => Promise<boolean>
  /** Provider supports posting a reply (GitHub in the Checks panel today). */
  canReply: boolean
  /**
   * Nested review-thread reply (pulls/.../comments/{id}/replies).
   * Only call when canPostPRReviewThreadReply(comment) is true.
   */
  replyInThread: (comment: PRComment, body: string) => Promise<boolean>
  /**
   * Top-level PR conversation comment (issues/.../comments), used for review
   * summaries and other comments that have no nested-reply endpoint (e.g. CodeRabbit).
   */
  replyAsConversation: (comment: PRComment, body: string) => Promise<boolean>
}

/**
 * GitHub App logins carry a `[bot]` suffix that does not resolve as an @-mention
 * (`@coderabbitai[bot]` renders literally; `@coderabbitai` reaches the bot).
 */
export function formatPRCommentMentionHandle(author: string | undefined): string {
  return (author ?? '').replace(/\[bot\]$/i, '').trim()
}

/** Top-level conversation reply body, addressed to the comment author. */
export function buildPRCommentConversationReplyBody(
  author: string | undefined,
  body: string
): string {
  const handle = formatPRCommentMentionHandle(author)
  return handle ? `@${handle} ${body}` : body
}

/**
 * True when GitHub can nest a reply under this comment (inline review-thread comment).
 * Conversation comments and PR review summaries (CodeRabbit, etc.) cannot use that API.
 */
export function canPostPRReviewThreadReply(
  comment: Pick<PRComment, 'id' | 'threadId' | 'path' | 'url'>
): boolean {
  if (!Number.isSafeInteger(comment.id) || comment.id <= 0) {
    return false
  }
  // Why: review-summary anchors use #pullrequestreview-N; that id is not a review
  // comment id and will 404 on the replies endpoint.
  if (typeof comment.url === 'string' && comment.url.includes('pullrequestreview')) {
    return false
  }
  // Why: threadId is the GraphQL thread key; path marks review comments even when
  // thread metadata is missing; #discussion_r is the REST anchor for review comments.
  if (Boolean(comment.threadId) || Boolean(comment.path)) {
    return true
  }
  return typeof comment.url === 'string' && comment.url.includes('discussion_r')
}

/**
 * Prefer the latest message in a thread so the fixing reply sits after existing replies.
 */
export function getPRCommentGroupReplyTarget(group: PRCommentGroup): PRComment {
  if (group.kind === 'thread' && group.replies.length > 0) {
    return group.replies.at(-1)!
  }
  return getPRCommentGroupRoot(group)
}

/**
 * Attach parent review-thread metadata so the sidebar groups the reply under the
 * original comment immediately (GitHub REST replies often omit threadId/path).
 */
export function attachPRReviewReplyParent(
  reply: PRComment,
  parent: Pick<PRComment, 'threadId' | 'path' | 'line' | 'isResolved' | 'isOutdated' | 'startLine'>
): PRComment {
  return {
    ...reply,
    threadId: reply.threadId ?? parent.threadId,
    path: reply.path ?? parent.path,
    line: reply.line ?? parent.line,
    startLine: reply.startLine ?? parent.startLine,
    isResolved: reply.isResolved ?? parent.isResolved,
    isOutdated: reply.isOutdated ?? parent.isOutdated
  }
}

/**
 * Resolve a threadId for a reply target from the live comment list when the
 * target itself is missing one (path-only review comments).
 */
export function resolvePRReviewReplyThreadId(args: {
  parent: Pick<PRComment, 'id' | 'threadId' | 'path' | 'line'>
  existingComments: readonly PRComment[]
}): string | undefined {
  if (args.parent.threadId) {
    return args.parent.threadId
  }
  const byId = args.existingComments.find(
    (comment) => comment.id === args.parent.id && Boolean(comment.threadId)
  )
  if (byId?.threadId) {
    return byId.threadId
  }
  if (!args.parent.path) {
    return undefined
  }
  const sibling = args.existingComments.find(
    (comment) =>
      Boolean(comment.threadId) &&
      comment.path === args.parent.path &&
      (args.parent.line == null || comment.line === args.parent.line)
  )
  return sibling?.threadId
}

/**
 * Drop the trailing headSha segment from a checks-panel async key.
 * Agent launch (submit-after-ready) can take long enough for PR head to move;
 * ack must not abort just because headSha churned.
 */
export function checksPanelReviewStableKey(asyncResultKey: string): string {
  const parts = asyncResultKey.split('::')
  if (parts.length <= 1) {
    return asyncResultKey
  }
  return parts.slice(0, -1).join('::')
}

/**
 * Bulk ack fans out over the host API (`gh`), which is slow on SSH; the shared
 * client already caps itself at 4 in-flight requests, so match that ceiling.
 */
export const PR_COMMENT_ACK_MAX_CONCURRENCY = 4

const EMPTY_ACK_COUNTS: PRCommentAiLaunchAckCounts = {
  resolved: 0,
  replied: 0,
  skipped: 0,
  failed: 0
}

/** Fixed-size worker pool; results stay in input order. */
async function mapWithBoundedConcurrency<T, R>(
  items: readonly T[],
  limit: number,
  run: (item: T) => Promise<R>
): Promise<R[]> {
  const results = Array.from<R>({ length: items.length })
  let next = 0
  const workers = Array.from({ length: Math.min(Math.max(limit, 1), items.length) }, async () => {
    while (next < items.length) {
      const index = next
      next += 1
      results[index] = await run(items[index]!)
    }
  })
  await Promise.all(workers)
  return results
}

/**
 * After launching an agent for selected review feedback:
 * post a fixing reply (nested when possible, else conversation @-reply), then
 * resolve host threads when possible.
 *
 * Why: replies use a snapshotted GitHub target and must not abort just because
 * the checks-panel async key churned mid-launch. isStillCurrent only gates
 * host-thread resolve + UI refresh, not the reply posts themselves.
 *
 * Groups run through a bounded pool; reply-before-resolve stays serial *within*
 * a group because the resolve decision reads live comment state the reply mutates.
 */
export async function acknowledgePRCommentsAfterAiLaunch(args: {
  groups: readonly PRCommentGroup[]
  deps: PRCommentAiLaunchAckDeps
}): Promise<PRCommentAiLaunchAckCounts> {
  const perGroup = await mapWithBoundedConcurrency(
    args.groups,
    PR_COMMENT_ACK_MAX_CONCURRENCY,
    (group) => acknowledgePRCommentGroup(group, args.deps)
  )

  return perGroup.reduce<PRCommentAiLaunchAckCounts>(
    (totals, counts) => ({
      resolved: totals.resolved + counts.resolved,
      replied: totals.replied + counts.replied,
      skipped: totals.skipped + counts.skipped,
      failed: totals.failed + counts.failed
    }),
    EMPTY_ACK_COUNTS
  )
}

async function acknowledgePRCommentGroup(
  group: PRCommentGroup,
  deps: PRCommentAiLaunchAckDeps
): Promise<PRCommentAiLaunchAckCounts> {
  const counts = { ...EMPTY_ACK_COUNTS }
  const replyTarget = getPRCommentGroupReplyTarget(group)
  const threadId =
    group.kind === 'thread' && isResolvablePRCommentGroup(group) ? group.threadId : null

  if (deps.canReply) {
    // Why: prefer nested review-thread replies; fall back to a top-level conversation
    // comment for review summaries / issue comments (CodeRabbit, etc.) that have no
    // replies endpoint.
    const repliedOk = canPostPRReviewThreadReply(replyTarget)
      ? await deps.replyInThread(replyTarget, PR_COMMENT_AI_FIXING_REPLY)
      : await deps.replyAsConversation(replyTarget, PR_COMMENT_AI_FIXING_REPLY)
    if (repliedOk) {
      counts.replied += 1
    } else {
      counts.failed += 1
    }
  } else if (threadId == null || !deps.isThreadStillResolvable(threadId)) {
    counts.skipped += 1
  }

  if (threadId == null || !deps.isThreadStillResolvable(threadId)) {
    return counts
  }

  // Why: resolve is UI/host-state sensitive; skip it if the panel context moved.
  // Replies already used a snapshotted target and must not be gated the same way.
  if (!deps.isStillCurrent()) {
    counts.skipped += 1
    return counts
  }

  if (await deps.resolveThread(threadId)) {
    counts.resolved += 1
  } else {
    // Why: a resolve failure leaves the thread open on the host regardless of whether
    // the reply landed; counting it only when !canReply made GitHub failures invisible.
    counts.failed += 1
  }
  return counts
}

/** Durable pending ack payload so dialog close / re-renders cannot drop it before launch. */
let pendingAiCommentAck: unknown = null

export function setPendingPRCommentAiAck<T>(payload: T): void {
  pendingAiCommentAck = payload
}

export function takePendingPRCommentAiAck<T>(): T | null {
  const payload = pendingAiCommentAck
  pendingAiCommentAck = null
  return (payload as T | null) ?? null
}

export function clearPendingPRCommentAiAck(): void {
  pendingAiCommentAck = null
}
