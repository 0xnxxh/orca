import type { GitHubReaction, GitHubReactionContent, PRComment } from '../../../shared/types'

export const GITHUB_REACTION_ORDER: readonly GitHubReactionContent[] = [
  '+1',
  '-1',
  'laugh',
  'confused',
  'heart',
  'hooray',
  'rocket',
  'eyes'
]

export function setCommentReaction(
  comment: PRComment,
  content: GitHubReactionContent,
  reacted: boolean
): PRComment {
  const reactions = comment.reactions ?? []
  const current = reactions.find((reaction) => reaction.content === content)
  if (Boolean(current?.viewerHasReacted) === reacted) {
    return comment
  }

  const nextCount = Math.max(0, (current?.count ?? 0) + (reacted ? 1 : -1))
  const nextReaction: GitHubReaction = {
    content,
    count: nextCount,
    viewerHasReacted: reacted
  }
  const nextReactions = reactions
    .filter((reaction) => reaction.content !== content)
    .concat(nextCount > 0 ? nextReaction : [])
    .sort(
      (left, right) =>
        GITHUB_REACTION_ORDER.indexOf(left.content) - GITHUB_REACTION_ORDER.indexOf(right.content)
    )

  return { ...comment, reactions: nextReactions.length > 0 ? nextReactions : undefined }
}

export function setReactionOnSubject(
  comments: readonly PRComment[],
  reactionSubjectId: string,
  content: GitHubReactionContent,
  reacted: boolean
): PRComment[] {
  return comments.map((comment) =>
    comment.reactionSubjectId === reactionSubjectId
      ? setCommentReaction(comment, content, reacted)
      : comment
  )
}
