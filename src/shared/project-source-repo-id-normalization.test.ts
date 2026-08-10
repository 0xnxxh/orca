import { describe, expect, it } from 'vitest'
import type { Project } from './types'
import { normalizePersistedProjectSourceRepoIds } from './project-source-repo-id-normalization'

function makeProject(id: string, sourceRepoIds: unknown = []): Project {
  return {
    id,
    displayName: id,
    badgeColor: '#737373',
    sourceRepoIds,
    createdAt: 1,
    updatedAt: 1
  } as Project
}

describe('normalizePersistedProjectSourceRepoIds', () => {
  it.each([null, undefined, {}, 'projects'])('treats a non-array container as empty', (input) => {
    expect(normalizePersistedProjectSourceRepoIds(input)).toEqual({ projects: [], changed: true })
  })

  it('drops malformed members while preserving valid row identity and order', () => {
    const first = Object.freeze(makeProject('first'))
    const second = Object.freeze(makeProject('second', ['repo-2']))
    const input = Object.freeze([null, first, 42, [], second, 'project'])

    const result = normalizePersistedProjectSourceRepoIds(input)

    expect(result).toEqual({ projects: [first, second], changed: true })
    expect(result.projects[0]).toBe(first)
    expect(result.projects[1]).toBe(second)
  })

  it('copies frozen rows only when source repo ids need repair', () => {
    const missing = Object.freeze(makeProject('missing', null))
    const mixedIds = Object.freeze(makeProject('mixed', Object.freeze(['repo-1', null, 7])))
    const input = Object.freeze([missing, mixedIds])

    const result = normalizePersistedProjectSourceRepoIds(input)

    expect(result.projects).toEqual([
      { ...missing, sourceRepoIds: [] },
      { ...mixedIds, sourceRepoIds: ['repo-1'] }
    ])
    expect(result.projects[0]).not.toBe(missing)
    expect(result.projects[1]).not.toBe(mixedIds)
  })
})
