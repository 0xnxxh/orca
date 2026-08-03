import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

const taskPageSource = readFileSync(new URL('./TaskPage.tsx', import.meta.url), 'utf8')

function sectionBetween(startAnchor: string, endAnchor: string): string {
  const start = taskPageSource.indexOf(startAnchor)
  expect(start, `missing anchor: ${startAnchor}`).toBeGreaterThanOrEqual(0)
  const end = taskPageSource.indexOf(endAnchor, start)
  expect(end, `missing anchor: ${endAnchor}`).toBeGreaterThan(start)
  return taskPageSource.slice(start, end)
}

describe('TaskPage Linear/Jira creation drafts', () => {
  it('mirrors typed text into each session draft behind the contentful gate', () => {
    expect(taskPageSource.split('isTaskCreationDraftContentful(draft)')).toHaveLength(4)
  })

  it('restores dismissed typed text when each dialog reopens', () => {
    expect(taskPageSource).toContain("setNewLinearProjectName(draft?.name ?? '')")
    expect(taskPageSource).toContain("setNewLinearProjectDescription(draft?.description ?? '')")
    expect(taskPageSource).toContain("setNewLinearProjectContent(draft?.content ?? '')")
    expect(taskPageSource).toContain("setNewLinearIssueTitle(issueDraft?.title ?? '')")
    expect(taskPageSource).toContain("setNewLinearIssueBody(issueDraft?.body ?? '')")
    expect(taskPageSource).toContain("setNewJiraIssueTitle(draft?.title ?? '')")
    expect(taskPageSource).toContain("setNewJiraIssueBody(draft?.body ?? '')")
  })

  it('discards each recovery draft only on a successful create', () => {
    const linearProjectSection = sectionBetween(
      'const handleCreateNewLinearProject',
      'const handleCreateNewLinearIssue'
    )
    expect(linearProjectSection).toContain('clearNewLinearProjectDraft()')

    const linearIssueSection = sectionBetween(
      'const handleCreateNewLinearIssue',
      'const handleCreateNewJiraIssue'
    )
    expect(linearIssueSection).toContain('clearNewLinearIssueDraft()')

    const jiraIssueSection = sectionBetween(
      'const handleCreateNewJiraIssue',
      'const githubTasksBusy'
    )
    expect(jiraIssueSection).toContain('clearNewJiraIssueDraft()')
  })
})
