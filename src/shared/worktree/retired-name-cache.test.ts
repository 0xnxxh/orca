import { describe, expect, it } from 'vitest'
import {
  NO_RETIRED_NAMES,
  readRetiredNamesForRepo,
  retiredNamesAfterRefresh,
  selectRetiredNames
} from './retired-name-cache'

describe('readRetiredNamesForRepo', () => {
  it('reads the requested repo only', () => {
    const result = { retiredNamesByRepo: { 'repo-1': ['nautilus'], 'repo-2': ['seahorse'] } }
    expect(readRetiredNamesForRepo(result, 'repo-1')).toEqual(['nautilus'])
  })

  it.each([
    ['a host predating the method', {}],
    ['a repo with no entry', { retiredNamesByRepo: { other: ['nautilus'] } }],
    ['a non-array row', { retiredNamesByRepo: { 'repo-1': 'nautilus' } }],
    ['a null result', null],
    ['a non-object result', 'nope']
  ])('answers empty for %s', (_label, result) => {
    expect(readRetiredNamesForRepo(result, 'repo-1')).toEqual([])
  })

  it('drops non-string elements, which would throw when normalized', () => {
    const result = { retiredNamesByRepo: { 'repo-1': ['nautilus', 42, null, 'seahorse'] } }
    expect(readRetiredNamesForRepo(result, 'repo-1')).toEqual(['nautilus', 'seahorse'])
  })
})

describe('retiredNamesAfterRefresh', () => {
  it('takes the new names on success', () => {
    const previous = { repoId: 'repo-1', names: ['nautilus'] }
    expect(retiredNamesAfterRefresh(previous, 'repo-1', ['nautilus', 'seahorse'])).toEqual({
      repoId: 'repo-1',
      names: ['nautilus', 'seahorse']
    })
  })

  // The divergence this module exists to close: mobile used to reset to [] here, which un-retires
  // every name in the window where the create form is asking for a suggestion.
  it('holds the previous names when the refresh fails', () => {
    const previous = { repoId: 'repo-1', names: ['nautilus'] }
    expect(retiredNamesAfterRefresh(previous, 'repo-1', null)).toEqual({
      repoId: 'repo-1',
      names: ['nautilus']
    })
  })

  it('does not carry another repo forward through a failure', () => {
    const previous = { repoId: 'repo-1', names: ['nautilus'] }
    expect(retiredNamesAfterRefresh(previous, 'repo-2', null)).toEqual({
      repoId: 'repo-2',
      names: NO_RETIRED_NAMES
    })
  })

  it('answers empty when the first fetch for a repo fails', () => {
    expect(retiredNamesAfterRefresh(null, 'repo-1', null).names).toEqual([])
  })
})

describe('selectRetiredNames', () => {
  it('serves a load only to the repo it answered for', () => {
    const loaded = { repoId: 'repo-1', names: ['nautilus'] }
    expect(selectRetiredNames(loaded, 'repo-1')).toEqual(['nautilus'])
    expect(selectRetiredNames(loaded, 'repo-2')).toEqual([])
    expect(selectRetiredNames(loaded, null)).toEqual([])
    expect(selectRetiredNames(null, 'repo-1')).toEqual([])
  })

  it('returns the stored array itself so downstream memos do not rerun', () => {
    const names = ['nautilus']
    expect(selectRetiredNames({ repoId: 'repo-1', names }, 'repo-1')).toBe(names)
  })
})
