import { describe, expect, it } from 'vitest'

import { formatPRDelta } from './task-page-pr-delta-summary'
import type { GitHubWorkItem } from '../../../shared/types'

function prItem(overrides: Partial<GitHubWorkItem> = {}): GitHubWorkItem {
  return {
    id: 'pr-1',
    type: 'pr',
    number: 1,
    title: 'Fix login',
    state: 'open',
    url: 'https://github.com/acme/app/pull/1',
    labels: [],
    updatedAt: '2026-01-01T00:00:00Z',
    author: 'octocat',
    repoId: 'repo-1',
    ...overrides
  }
}

describe('formatPRDelta', () => {
  it('returns null when no diffstat fields are present', () => {
    expect(formatPRDelta(prItem())).toBeNull()
  })

  it('renders additions, deletions, and file count in order', () => {
    expect(formatPRDelta(prItem({ additions: 12, deletions: 3, changedFiles: 4 }))).toBe(
      '+12 -3 4 files'
    )
  })

  it('singularizes a one-file change', () => {
    expect(formatPRDelta(prItem({ changedFiles: 1 }))).toBe('1 file')
  })

  it('pluralizes a zero-file change', () => {
    // characterization: current behavior — only exactly 1 is singular.
    expect(formatPRDelta(prItem({ changedFiles: 0 }))).toBe('0 files')
  })

  it('keeps zero values because the check is on the type, not truthiness', () => {
    expect(formatPRDelta(prItem({ additions: 0, deletions: 0 }))).toBe('+0 -0')
  })

  it('omits fields that are absent', () => {
    expect(formatPRDelta(prItem({ additions: 5 }))).toBe('+5')
    expect(formatPRDelta(prItem({ deletions: 5 }))).toBe('-5')
  })

  it('renders negative deletions with the literal minus prefix', () => {
    // characterization: current behavior — the prefix is unconditional.
    expect(formatPRDelta(prItem({ deletions: -2 }))).toBe('--2')
  })
})
