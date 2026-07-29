import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

function readSource(relativePath: string): string {
  return readFileSync(fileURLToPath(new URL(relativePath, import.meta.url)), 'utf8')
}

function extractActionSelector(source: string, constName: string): string {
  const match = source.match(new RegExp(`const ${constName}\\s*=\\s*\\n?\\s*'([^']+)'`))
  if (!match?.[1]) {
    throw new Error(`Could not extract ${constName}`)
  }
  return match[1]
}

describe('project header action selectors', () => {
  it('keeps repo and group action selectors in lockstep', () => {
    // Why: WorktreeList.shouldIgnoreRepoHeaderToggle always uses the repo helper for both
    // header kinds; group drag-start uses the group selector. They must stay identical.
    const repoSelector = extractActionSelector(
      readSource('./project-header-drag-contract.ts'),
      'REPO_HEADER_ACTION_SELECTOR'
    )
    const groupSelector = extractActionSelector(
      readSource('./project-group-header-drag-contract.ts'),
      'PROJECT_GROUP_HEADER_ACTION_SELECTOR'
    )

    expect(repoSelector).toBe(groupSelector)
    expect(repoSelector).toContain('[data-repo-header-actions]')
  })
})
