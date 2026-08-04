import { describe, expect, it } from 'vitest'
import type { WorktreeMeta } from '../../../../shared/types'
import {
  buildWorktreeMetaUpdates,
  type WorktreeMetaDraft,
  type WorktreeMetaSnapshot
} from './worktree-meta-updates'

function makeDraft(overrides: Partial<WorktreeMetaDraft> = {}): WorktreeMetaDraft {
  return {
    displayNameInput: 'Workspace',
    issueInput: '',
    issueProvider: 'github',
    prInput: '',
    commentInput: '',
    ...overrides
  }
}

function makeSnapshot(overrides: Partial<WorktreeMetaSnapshot> = {}): WorktreeMetaSnapshot {
  return {
    displayName: 'Workspace',
    issueInput: '',
    issueProvider: 'github',
    ...overrides
  }
}

/** Persistence raw-spreads updates, so a present-but-undefined key erases the
 *  stored value — the invariant is asserted on every build in this suite. */
function buildUpdates(
  draft: Partial<WorktreeMetaDraft>,
  snapshot: Partial<WorktreeMetaSnapshot> = {}
): Partial<WorktreeMeta> {
  const updates = buildWorktreeMetaUpdates(makeDraft(draft), makeSnapshot(snapshot))
  const undefinedKeys = Object.keys(updates).filter(
    (key) => updates[key as keyof WorktreeMeta] === undefined
  )
  expect(undefinedKeys).toEqual([])
  return updates
}

const LINEAR_LINK_KEYS = [
  'linkedLinearIssue',
  'linkedLinearIssueWorkspaceId',
  'linkedLinearIssueOrganizationUrlKey'
] as const

describe('buildWorktreeMetaUpdates', () => {
  // The dialog opens focused on Comment, so this is the common save path; a
  // regression here silently destroys the user's existing link.
  it('emits no link keys when the issue field is untouched', () => {
    const updates = buildUpdates(
      { issueInput: 'STA-335', issueProvider: 'linear', commentInput: 'shipping today' },
      { issueInput: 'STA-335', issueProvider: 'linear' }
    )

    expect(updates.comment).toBe('shipping today')
    expect(updates).toHaveProperty('linkedPR', null)
    expect(updates).not.toHaveProperty('linkedIssue')
    for (const key of LINEAR_LINK_KEYS) {
      expect(updates).not.toHaveProperty(key)
    }
  })

  it('writes a GitHub issue number and clears the Linear slots', () => {
    expect(buildUpdates({ issueInput: '12' })).toEqual({
      comment: '',
      linkedIssue: 12,
      linkedLinearIssue: null,
      linkedLinearIssueWorkspaceId: null,
      linkedLinearIssueOrganizationUrlKey: null,
      linkedPR: null
    })
  })

  it('writes a bare Linear identifier and clears the stored organization key', () => {
    expect(buildUpdates({ issueInput: 'sta-335', issueProvider: 'linear' })).toEqual({
      comment: '',
      linkedIssue: null,
      linkedLinearIssue: 'STA-335',
      linkedLinearIssueWorkspaceId: null,
      linkedLinearIssueOrganizationUrlKey: null,
      linkedPR: null
    })
  })

  it('takes the organization key from a Linear issue URL', () => {
    expect(
      buildUpdates({
        issueInput: 'https://linear.app/acme/issue/STA-335/fix-auth',
        issueProvider: 'linear'
      })
    ).toEqual({
      comment: '',
      linkedIssue: null,
      linkedLinearIssue: 'STA-335',
      linkedLinearIssueWorkspaceId: null,
      linkedLinearIssueOrganizationUrlKey: 'acme',
      linkedPR: null
    })
  })

  it('clears every provider slot when the issue field is emptied', () => {
    expect(buildUpdates({ issueInput: '  ' }, { issueInput: '42' })).toEqual({
      comment: '',
      linkedIssue: null,
      linkedLinearIssue: null,
      linkedLinearIssueWorkspaceId: null,
      linkedLinearIssueOrganizationUrlKey: null,
      linkedPR: null
    })
  })

  it('treats a provider switch with unchanged text as dirty', () => {
    const updates = buildUpdates(
      { issueInput: 'STA-335', issueProvider: 'linear' },
      { issueInput: 'STA-335', issueProvider: 'github' }
    )

    expect(updates.linkedLinearIssue).toBe('STA-335')
    expect(updates.linkedIssue).toBeNull()
  })

  it('displaces a Linear linked work item when the issue field changes', () => {
    const updates = buildUpdates(
      { issueInput: '12' },
      { linkedWorkItemProvider: 'linear', linkedWorkItemType: 'issue' }
    )

    expect(updates).toHaveProperty('linkedWorkItem', null)
    expect(updates).toHaveProperty('linkedTaskSourceContext', null)
  })

  // linkedWorkItem also records the PR or MR a workspace was created from, which
  // the Issue row does not own and must not drop.
  it('leaves a PR-typed work item alone', () => {
    const updates = buildUpdates(
      { issueInput: '12' },
      { linkedWorkItemProvider: 'github', linkedWorkItemType: 'pr' }
    )

    expect(updates).not.toHaveProperty('linkedWorkItem')
    expect(updates).not.toHaveProperty('linkedTaskSourceContext')
  })

  it('leaves work items owned by other providers alone', () => {
    for (const provider of ['jira', 'gitlab'] as const) {
      const updates = buildUpdates(
        { issueInput: '12' },
        { linkedWorkItemProvider: provider, linkedWorkItemType: 'issue' }
      )

      expect(updates).not.toHaveProperty('linkedWorkItem')
      expect(updates).not.toHaveProperty('linkedTaskSourceContext')
    }
  })

  // The row cannot render a GitLab or Jira issue, so clearing one would destroy a
  // link the user was never shown — and neither has another editor to restore it.
  it('leaves a GitLab issue attached', () => {
    expect(buildUpdates({ issueInput: '12' })).not.toHaveProperty('linkedGitLabIssue')
    expect(
      buildUpdates({ issueInput: '12' }, { linkedWorkItemProvider: 'gitlab' })
    ).not.toHaveProperty('linkedGitLabIssue')
  })

  it('ignores a provider switch on an empty field', () => {
    const updates = buildUpdates(
      { issueInput: '', issueProvider: 'linear' },
      { issueInput: '', issueProvider: 'github' }
    )

    expect(updates).not.toHaveProperty('linkedIssue')
    for (const key of LINEAR_LINK_KEYS) {
      expect(updates).not.toHaveProperty(key)
    }
  })

  it('does not displace a Linear work item when the issue field is clean', () => {
    const updates = buildUpdates({ commentInput: 'note' }, { linkedWorkItemProvider: 'linear' })

    expect(updates).not.toHaveProperty('linkedWorkItem')
    expect(updates).not.toHaveProperty('linkedTaskSourceContext')
  })

  it('leaves links untouched for unparseable issue input', () => {
    const updates = buildUpdates(
      { issueInput: 'not an issue', displayNameInput: 'Renamed', commentInput: 'note' },
      { displayName: 'Workspace' }
    )

    expect(updates).toEqual({
      comment: 'note',
      displayName: 'Renamed',
      linkedPR: null
    })
  })

  it('clears a display name with empty string, never a present-undefined key', () => {
    const updates = buildUpdates({ displayNameInput: '   ' }, { displayName: 'Custom Name' })

    expect(updates.displayName).toBe('')
  })

  it('rejects issue URLs in the PR input', () => {
    expect(buildUpdates({ prInput: 'https://github.com/stablyai/orca/issues/6933' })).toEqual({
      comment: ''
    })
  })

  it('accepts PR URLs in the PR input', () => {
    expect(buildUpdates({ prInput: 'https://github.com/stablyai/orca/pull/6934' })).toEqual({
      comment: '',
      linkedPR: 6934
    })
  })

  it('accepts issue URLs in the issue input', () => {
    expect(buildUpdates({ issueInput: 'https://github.com/stablyai/orca/issues/6933' })).toEqual({
      comment: '',
      linkedIssue: 6933,
      linkedLinearIssue: null,
      linkedLinearIssueWorkspaceId: null,
      linkedLinearIssueOrganizationUrlKey: null,
      linkedPR: null
    })
  })

  it('rejects PR URLs in the issue input', () => {
    expect(buildUpdates({ issueInput: 'https://github.com/stablyai/orca/pull/6934' })).toEqual({
      comment: '',
      linkedPR: null
    })
  })
})
