import { describe, expect, it } from 'vitest'
import { MARINE_CREATURES } from '../shared/marine-creatures'
import { collectRetiredNamesFromPaths, extractCandidateLeafNames } from './worktree-name-retirement'

const FIRST = MARINE_CREATURES[0].toLowerCase()
const SECOND = MARINE_CREATURES[1].toLowerCase()

describe('extractCandidateLeafNames', () => {
  it('takes the trailing segment of a real path', () => {
    expect(extractCandidateLeafNames(`/Users/ada/orca/workspaces/orca/${FIRST}`)).toEqual([FIRST])
  })

  it('takes the trailing segment of a dash-encoded transcript bucket', () => {
    expect(extractCandidateLeafNames(`-Users-ada-orca-workspaces-orca-${FIRST}`)).toEqual([FIRST])
  })

  it('keeps a numeric tail attached so suffixed variants retire as themselves', () => {
    // Why: returning only the base would retire "gar" and leave "gar-2" issuable.
    expect(extractCandidateLeafNames(`-Users-ada-worktrees-${FIRST}-2`)).toEqual([
      `${FIRST}-2`,
      FIRST
    ])
  })

  it('handles Windows separators and trailing separators', () => {
    expect(extractCandidateLeafNames(`C:\\worktrees\\${FIRST}\\`)).toEqual([FIRST])
  })

  it('returns nothing for an empty or separator-only input', () => {
    expect(extractCandidateLeafNames('')).toEqual([])
    expect(extractCandidateLeafNames('---')).toEqual([])
  })
})

describe('collectRetiredNamesFromPaths', () => {
  it('retires pool names found in live workspace directories', () => {
    expect(collectRetiredNamesFromPaths([FIRST, SECOND])).toEqual(new Set([FIRST, SECOND]))
  })

  it('retires a name whose directory is gone but whose transcript bucket survives', () => {
    // The core case: this is the evidence that a deleted workspace left agent state behind.
    expect(collectRetiredNamesFromPaths([`-Users-ada-orca-workspaces-orca-${FIRST}`])).toEqual(
      new Set([FIRST])
    )
  })

  it('retires a suffixed variant without also freeing it', () => {
    const retired = collectRetiredNamesFromPaths([`-Users-ada-worktrees-${FIRST}-2`])
    expect(retired.has(`${FIRST}-2`)).toBe(true)
  })

  it('ignores paths that contain no pool name', () => {
    expect(
      collectRetiredNamesFromPaths(['-Users-ada-orca-workspaces-orca-fix-login-redirect'])
    ).toEqual(new Set())
  })

  it('is case-insensitive', () => {
    expect(collectRetiredNamesFromPaths([MARINE_CREATURES[0].toUpperCase()])).toEqual(
      new Set([FIRST])
    )
  })

  it('skips non-string and empty entries without throwing', () => {
    const paths = [undefined, null, '', FIRST] as unknown as string[]
    expect(collectRetiredNamesFromPaths(paths)).toEqual(new Set([FIRST]))
  })
})
