import { describe, expect, it, vi } from 'vitest'
import type { PRComment } from '../../../../shared/types'
import type { PRCommentGroup } from '@/lib/pr-comment-groups'
import {
  acknowledgePRCommentsAfterAiLaunch,
  attachPRReviewReplyParent,
  buildPRCommentConversationReplyBody,
  canPostPRReviewThreadReply,
  checksPanelReviewStableKey,
  clearPendingPRCommentAiAck,
  formatPRCommentMentionHandle,
  getPRCommentGroupReplyTarget,
  PR_COMMENT_ACK_MAX_CONCURRENCY,
  PR_COMMENT_AI_FIXING_REPLY,
  resolvePRReviewReplyThreadId,
  setPendingPRCommentAiAck,
  takePendingPRCommentAiAck
} from './pr-comments-ai-launch-ack'

function comment(overrides: Partial<PRComment> = {}): PRComment {
  return {
    id: 1,
    author: 'alice',
    authorAvatarUrl: '',
    body: 'Please update this.',
    createdAt: '2026-05-14T00:00:00Z',
    url: 'https://github.com/acme/widgets/pull/42#discussion_r1',
    ...overrides
  }
}

type PRCommentThreadGroup = Extract<PRCommentGroup, { kind: 'thread' }>
type PRCommentStandaloneGroup = Extract<PRCommentGroup, { kind: 'standalone' }>

function openThread(threadId: string, id = 10): PRCommentThreadGroup {
  return {
    kind: 'thread',
    threadId,
    root: comment({ id, threadId, path: 'src/a.ts', isResolved: false }),
    replies: []
  }
}

function standalone(id = 20): PRCommentStandaloneGroup {
  return {
    kind: 'standalone',
    comment: comment({
      id,
      body: 'Overall looks good; one nit.',
      url: 'https://github.com/x/y/pull/1#issuecomment-9'
    })
  }
}

function codeRabbitReviewSummary(id = 30): PRCommentStandaloneGroup {
  return {
    kind: 'standalone',
    comment: comment({
      id,
      author: 'coderabbitai',
      isBot: true,
      body: '## Nitpick comments (2)\n\n...',
      url: 'https://github.com/acme/widgets/pull/42#pullrequestreview-999'
    })
  }
}

describe('canPostPRReviewThreadReply', () => {
  it('allows review-thread comments with threadId, path, or discussion_r url', () => {
    expect(canPostPRReviewThreadReply(comment({ id: 1, threadId: 'T1' }))).toBe(true)
    expect(canPostPRReviewThreadReply(comment({ id: 2, path: 'a.ts' }))).toBe(true)
    expect(
      canPostPRReviewThreadReply(
        comment({ id: 3, url: 'https://github.com/acme/widgets/pull/42#discussion_r99' })
      )
    ).toBe(true)
  })

  it('rejects conversation comments, review summaries, and invalid ids', () => {
    expect(
      canPostPRReviewThreadReply(
        comment({ id: 3, url: 'https://github.com/acme/widgets/pull/42#issuecomment-9' })
      )
    ).toBe(false)
    expect(
      canPostPRReviewThreadReply(
        comment({
          id: 4,
          url: 'https://github.com/acme/widgets/pull/42#pullrequestreview-999'
        })
      )
    ).toBe(false)
    expect(canPostPRReviewThreadReply(comment({ id: 0, threadId: 'T1' }))).toBe(false)
  })

  // Why: CodeRabbit review summaries can still carry path/threadId metadata; the
  // pullrequestreview anchor must win or the replies endpoint 404s.
  it('rejects review summaries even when thread metadata is present', () => {
    expect(
      canPostPRReviewThreadReply(
        comment({
          id: 5,
          threadId: 'T1',
          path: 'src/a.ts',
          url: 'https://github.com/acme/widgets/pull/42#pullrequestreview-999'
        })
      )
    ).toBe(false)
  })
})

describe('buildPRCommentConversationReplyBody', () => {
  it('strips the [bot] login suffix so the mention resolves', () => {
    expect(formatPRCommentMentionHandle('coderabbitai[bot]')).toBe('coderabbitai')
    expect(
      buildPRCommentConversationReplyBody('coderabbitai[bot]', PR_COMMENT_AI_FIXING_REPLY)
    ).toBe(`@coderabbitai ${PR_COMMENT_AI_FIXING_REPLY}`)
  })

  it('keeps human logins and drops the mention when the author is unknown', () => {
    expect(buildPRCommentConversationReplyBody('alice', 'Fixing.')).toBe('@alice Fixing.')
    expect(buildPRCommentConversationReplyBody(undefined, 'Fixing.')).toBe('Fixing.')
  })
})

describe('getPRCommentGroupReplyTarget', () => {
  it('uses the latest reply in a thread when present', () => {
    const group: PRCommentGroup = {
      kind: 'thread',
      threadId: 'T1',
      root: comment({ id: 10, threadId: 'T1', path: 'a.ts' }),
      replies: [
        comment({ id: 11, threadId: 'T1', path: 'a.ts', body: 'first' }),
        comment({ id: 12, threadId: 'T1', path: 'a.ts', body: 'latest' })
      ]
    }
    expect(getPRCommentGroupReplyTarget(group).id).toBe(12)
  })

  it('falls back to the root when there are no replies', () => {
    const group = openThread('T1', 10)
    expect(getPRCommentGroupReplyTarget(group).id).toBe(10)
  })
})

describe('attachPRReviewReplyParent', () => {
  it('fills missing thread metadata from the parent', () => {
    const parent = comment({
      id: 10,
      threadId: 'T1',
      path: 'src/a.ts',
      line: 4,
      isResolved: false
    })
    const reply = comment({ id: 99, body: 'Fixing.' })
    expect(attachPRReviewReplyParent(reply, parent)).toMatchObject({
      id: 99,
      body: 'Fixing.',
      threadId: 'T1',
      path: 'src/a.ts',
      line: 4,
      isResolved: false
    })
  })

  it('does not overwrite explicit reply metadata', () => {
    const parent = comment({ id: 10, threadId: 'T1', path: 'src/a.ts', line: 4 })
    const reply = comment({ id: 99, threadId: 'T2', path: 'src/b.ts', line: 9 })
    expect(attachPRReviewReplyParent(reply, parent)).toMatchObject({
      threadId: 'T2',
      path: 'src/b.ts',
      line: 9
    })
  })
})

describe('resolvePRReviewReplyThreadId', () => {
  it('prefers the parent threadId', () => {
    expect(
      resolvePRReviewReplyThreadId({
        parent: comment({ id: 1, threadId: 'T1', path: 'a.ts' }),
        existingComments: []
      })
    ).toBe('T1')
  })

  it('recovers threadId from existing comments by id or path/line', () => {
    const existing = [
      comment({ id: 1, threadId: 'T_path', path: 'src/a.ts', line: 3 }),
      comment({ id: 2, threadId: 'T_id', path: 'src/b.ts', line: 9 })
    ]
    expect(
      resolvePRReviewReplyThreadId({
        parent: comment({ id: 2, path: 'src/b.ts', line: 9 }),
        existingComments: existing
      })
    ).toBe('T_id')
    expect(
      resolvePRReviewReplyThreadId({
        parent: comment({ id: 50, path: 'src/a.ts', line: 3 }),
        existingComments: existing
      })
    ).toBe('T_path')
  })
})

describe('checksPanelReviewStableKey', () => {
  it('drops the trailing headSha segment', () => {
    expect(checksPanelReviewStableKey('repo::main::owner/repo::12::abc123')).toBe(
      'repo::main::owner/repo::12'
    )
  })

  it('passes through a key with no separator', () => {
    expect(checksPanelReviewStableKey('solo')).toBe('solo')
  })
})

describe('acknowledgePRCommentsAfterAiLaunch', () => {
  it('replies in-thread and resolves host-resolvable threads', async () => {
    const resolveThread = vi.fn().mockResolvedValue(true)
    const replyInThread = vi.fn().mockResolvedValue(true)
    const replyAsConversation = vi.fn().mockResolvedValue(true)
    const group = openThread('T1')

    const result = await acknowledgePRCommentsAfterAiLaunch({
      groups: [group, openThread('T2', 11)],
      deps: {
        isStillCurrent: () => true,
        isThreadStillResolvable: () => true,
        resolveThread,
        canReply: true,
        replyInThread,
        replyAsConversation
      }
    })

    expect(result).toEqual({ resolved: 2, replied: 2, skipped: 0, failed: 0 })
    expect(replyInThread).toHaveBeenCalledTimes(2)
    expect(replyInThread).toHaveBeenCalledWith(group.root, PR_COMMENT_AI_FIXING_REPLY)
    expect(replyAsConversation).not.toHaveBeenCalled()
    expect(resolveThread).toHaveBeenCalledTimes(2)
  })

  // Why: on GitHub canReply is true; a failed resolve still leaves the thread open and
  // must count as failed or the success toast lies.
  it('still replies in-thread when resolve fails, and counts the failed resolve', async () => {
    const replyInThread = vi.fn().mockResolvedValue(true)
    const group = openThread('T1')

    const result = await acknowledgePRCommentsAfterAiLaunch({
      groups: [group],
      deps: {
        isStillCurrent: () => true,
        isThreadStillResolvable: () => true,
        resolveThread: vi.fn().mockResolvedValue(false),
        canReply: true,
        replyInThread,
        replyAsConversation: vi.fn()
      }
    })

    expect(result).toEqual({ resolved: 0, replied: 1, skipped: 0, failed: 1 })
    expect(replyInThread).toHaveBeenCalledWith(group.root, PR_COMMENT_AI_FIXING_REPLY)
  })

  it('posts a conversation @-reply for standalone conversation comments', async () => {
    const replyAsConversation = vi.fn().mockResolvedValue(true)
    const group = standalone(42)

    const result = await acknowledgePRCommentsAfterAiLaunch({
      groups: [group],
      deps: {
        isStillCurrent: () => true,
        isThreadStillResolvable: () => true,
        resolveThread: vi.fn(),
        canReply: true,
        replyInThread: vi.fn(),
        replyAsConversation
      }
    })

    expect(result).toEqual({ resolved: 0, replied: 1, skipped: 0, failed: 0 })
    expect(replyAsConversation).toHaveBeenCalledWith(group.comment, PR_COMMENT_AI_FIXING_REPLY)
  })

  it('posts a conversation @-reply for CodeRabbit review summaries', async () => {
    const replyInThread = vi.fn().mockResolvedValue(true)
    const replyAsConversation = vi.fn().mockResolvedValue(true)
    const group = codeRabbitReviewSummary(77)

    const result = await acknowledgePRCommentsAfterAiLaunch({
      groups: [group],
      deps: {
        isStillCurrent: () => true,
        isThreadStillResolvable: () => true,
        resolveThread: vi.fn(),
        canReply: true,
        replyInThread,
        replyAsConversation
      }
    })

    expect(result).toEqual({ resolved: 0, replied: 1, skipped: 0, failed: 0 })
    expect(replyInThread).not.toHaveBeenCalled()
    expect(replyAsConversation).toHaveBeenCalledWith(group.comment, PR_COMMENT_AI_FIXING_REPLY)
  })

  // Why: the reported bug — a selection of only unresolvable CodeRabbit summaries
  // produced replied=0 because the ack ran the resolve path and nothing else.
  it('replies to every unresolvable review summary in the selection', async () => {
    const replyAsConversation = vi.fn().mockResolvedValue(true)
    const resolveThread = vi.fn()

    const result = await acknowledgePRCommentsAfterAiLaunch({
      groups: [codeRabbitReviewSummary(30), codeRabbitReviewSummary(31)],
      deps: {
        isStillCurrent: () => true,
        isThreadStillResolvable: () => false,
        resolveThread,
        canReply: true,
        replyInThread: vi.fn(),
        replyAsConversation
      }
    })

    expect(result).toEqual({ resolved: 0, replied: 2, skipped: 0, failed: 0 })
    expect(resolveThread).not.toHaveBeenCalled()
  })

  it('mixes in-thread and conversation replies in a single selection', async () => {
    const replyInThread = vi.fn().mockResolvedValue(true)
    const replyAsConversation = vi.fn().mockResolvedValue(true)
    const thread = openThread('T1', 10)
    const summary = codeRabbitReviewSummary(30)

    const result = await acknowledgePRCommentsAfterAiLaunch({
      groups: [thread, summary],
      deps: {
        isStillCurrent: () => true,
        isThreadStillResolvable: () => true,
        resolveThread: vi.fn().mockResolvedValue(true),
        canReply: true,
        replyInThread,
        replyAsConversation
      }
    })

    expect(result).toEqual({ resolved: 1, replied: 2, skipped: 0, failed: 0 })
    expect(replyInThread).toHaveBeenCalledWith(thread.root, PR_COMMENT_AI_FIXING_REPLY)
    expect(replyAsConversation).toHaveBeenCalledWith(summary.comment, PR_COMMENT_AI_FIXING_REPLY)
  })

  it('counts a failed conversation reply instead of silently reporting success', async () => {
    const result = await acknowledgePRCommentsAfterAiLaunch({
      groups: [codeRabbitReviewSummary(30)],
      deps: {
        isStillCurrent: () => true,
        isThreadStillResolvable: () => false,
        resolveThread: vi.fn(),
        canReply: true,
        replyInThread: vi.fn(),
        replyAsConversation: vi.fn().mockResolvedValue(false)
      }
    })

    expect(result).toEqual({ resolved: 0, replied: 0, skipped: 0, failed: 1 })
  })

  it('replies to the latest message in a multi-comment thread', async () => {
    const replyInThread = vi.fn().mockResolvedValue(true)
    const group: PRCommentGroup = {
      kind: 'thread',
      threadId: 'T1',
      root: comment({ id: 10, threadId: 'T1', path: 'a.ts', isResolved: false }),
      replies: [comment({ id: 11, threadId: 'T1', path: 'a.ts', body: 'prior reply' })]
    }

    const result = await acknowledgePRCommentsAfterAiLaunch({
      groups: [group],
      deps: {
        isStillCurrent: () => true,
        isThreadStillResolvable: () => false,
        resolveThread: vi.fn(),
        canReply: true,
        replyInThread,
        replyAsConversation: vi.fn()
      }
    })

    expect(result).toEqual({ resolved: 0, replied: 1, skipped: 0, failed: 0 })
    expect(replyInThread).toHaveBeenCalledWith(group.replies[0], PR_COMMENT_AI_FIXING_REPLY)
  })

  it('skips when reply is unavailable and resolve cannot run', async () => {
    const result = await acknowledgePRCommentsAfterAiLaunch({
      groups: [standalone()],
      deps: {
        isStillCurrent: () => true,
        isThreadStillResolvable: () => true,
        resolveThread: vi.fn(),
        canReply: false,
        replyInThread: vi.fn(),
        replyAsConversation: vi.fn()
      }
    })

    expect(result).toEqual({ resolved: 0, replied: 0, skipped: 1, failed: 0 })
  })

  it('counts a failure when resolve fails and reply is unavailable', async () => {
    const result = await acknowledgePRCommentsAfterAiLaunch({
      groups: [openThread('T1')],
      deps: {
        isStillCurrent: () => true,
        isThreadStillResolvable: () => true,
        resolveThread: vi.fn().mockResolvedValue(false),
        canReply: false,
        replyInThread: vi.fn(),
        replyAsConversation: vi.fn()
      }
    })

    expect(result).toEqual({ resolved: 0, replied: 0, skipped: 0, failed: 1 })
  })

  it('keeps a durable pending payload across take', () => {
    clearPendingPRCommentAiAck()
    setPendingPRCommentAiAck({ groups: 2 })
    expect(takePendingPRCommentAiAck<{ groups: number }>()).toEqual({ groups: 2 })
    expect(takePendingPRCommentAiAck()).toBeNull()
  })

  it('still posts all replies when the review context becomes stale mid-loop', async () => {
    let live = true
    const replyInThread = vi.fn().mockImplementation(async () => {
      live = false
      return true
    })
    const resolveThread = vi.fn().mockResolvedValue(true)

    const result = await acknowledgePRCommentsAfterAiLaunch({
      groups: [openThread('T1'), openThread('T2', 11), openThread('T3', 12)],
      deps: {
        isStillCurrent: () => live,
        isThreadStillResolvable: () => true,
        resolveThread,
        canReply: true,
        replyInThread,
        replyAsConversation: vi.fn()
      }
    })

    // Why: replies must not depend on checks-panel key stability; resolve stops after context
    // goes stale, and each skipped resolve is reported rather than silently counted as success.
    expect(replyInThread).toHaveBeenCalledTimes(3)
    expect(resolveThread).toHaveBeenCalledTimes(0)
    expect(result).toEqual({ resolved: 0, replied: 3, skipped: 3, failed: 0 })
  })

  it('counts a failed resolve on a group whose reply also failed', async () => {
    const result = await acknowledgePRCommentsAfterAiLaunch({
      groups: [openThread('T1')],
      deps: {
        isStillCurrent: () => true,
        isThreadStillResolvable: () => true,
        resolveThread: vi.fn().mockResolvedValue(false),
        canReply: true,
        replyInThread: vi.fn().mockResolvedValue(false),
        replyAsConversation: vi.fn()
      }
    })

    expect(result).toEqual({ resolved: 0, replied: 0, skipped: 0, failed: 2 })
  })

  it('reports a resolvable thread as skipped when the panel context moved', async () => {
    const resolveThread = vi.fn()

    const result = await acknowledgePRCommentsAfterAiLaunch({
      groups: [openThread('T1')],
      deps: {
        isStillCurrent: () => false,
        isThreadStillResolvable: () => true,
        resolveThread,
        canReply: true,
        replyInThread: vi.fn().mockResolvedValue(true),
        replyAsConversation: vi.fn()
      }
    })

    expect(result).toEqual({ resolved: 0, replied: 1, skipped: 1, failed: 0 })
    expect(resolveThread).not.toHaveBeenCalled()
  })

  it('runs groups with bounded concurrency, replying before resolving in each group', async () => {
    const groups = Array.from({ length: 9 }, (_, index) => openThread(`T${index}`, 100 + index))
    const order: string[] = []
    let inFlight = 0
    let peakInFlight = 0

    const track = async <T>(label: string, value: T): Promise<T> => {
      inFlight += 1
      peakInFlight = Math.max(peakInFlight, inFlight)
      order.push(label)
      await Promise.resolve()
      inFlight -= 1
      return value
    }

    const result = await acknowledgePRCommentsAfterAiLaunch({
      groups,
      deps: {
        isStillCurrent: () => true,
        isThreadStillResolvable: () => true,
        resolveThread: (threadId) => track(`resolve:${threadId}`, true),
        canReply: true,
        replyInThread: (comment) => track(`reply:${comment.threadId}`, true),
        replyAsConversation: vi.fn()
      }
    })

    expect(result).toEqual({ resolved: 9, replied: 9, skipped: 0, failed: 0 })
    expect(peakInFlight).toBeGreaterThan(1)
    expect(peakInFlight).toBeLessThanOrEqual(PR_COMMENT_ACK_MAX_CONCURRENCY)
    for (const group of groups) {
      expect(order.indexOf(`reply:${group.threadId}`)).toBeLessThan(
        order.indexOf(`resolve:${group.threadId}`)
      )
    }
  })
})
