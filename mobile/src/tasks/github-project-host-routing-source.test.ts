import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

const source = readFileSync(new URL('../../app/h/[hostId]/tasks.tsx', import.meta.url), 'utf8')
const mutationSource = readFileSync(
  new URL('./native-host-task-project-mutation-operations.ts', import.meta.url),
  'utf8'
)

describe('mobile GitHub Project host routing boundary', () => {
  it('host-qualifies every Project RPC request', () => {
    expect(source).not.toMatch(/['"]github\.project\./)
    const calls = [...mutationSource.matchAll(/['"](github\.project\.[^'"]+)['"]/g)]
    expect(calls.length).toBeGreaterThan(5)
    for (const call of calls) {
      const request = mutationSource.slice(call.index, call.index + 700)
      expect(request, `${call[1]} must carry a host`).toMatch(/\bhost\s*:|slugPayload\(target\)/)
    }
  })

  it('pins Project-row PR actions to the row repository identity', () => {
    const start = source.indexOf('const toggleProjectGitHubReviewThread')
    const end = source.indexOf('const refreshGitHubChecks', start)
    const actions = source.slice(start, end)
    for (const method of [
      'github.prChecks',
      'github.setPRFileViewed',
      'github.prFileContents',
      'github.addPRReviewComment'
    ]) {
      expect(actions).not.toContain(`'${method}'`)
    }
    for (const operation of [
      'resolveReviewThread',
      'replyReviewComment',
      'addConversationComment',
      'requestReviewers',
      'rerunChecks',
      'merge'
    ]) {
      expect(actions).toContain(`taskProjectMutationOperations.${operation}`)
    }
    for (const operation of [
      'refreshChecks',
      'setFileViewed',
      'loadFileContents',
      'addInlineComment'
    ]) {
      expect(actions).toContain(`taskProjectFileOperations.${operation}`)
    }
  })

  it('pins discovery to github.com while pasted URLs supply their parsed host', () => {
    expect(source).toContain("taskProjectReadOperations.listAccessible('github.com')")
    expect(source).toContain('host: githubProjectHost(parsed.host)')
  })
})
