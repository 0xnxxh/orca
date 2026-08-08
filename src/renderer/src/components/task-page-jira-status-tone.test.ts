import { describe, expect, it } from 'vitest'

import { getJiraStatusTone } from './task-page-jira-status-tone'

describe('getJiraStatusTone', () => {
  it('uses the emerald tone for the done category', () => {
    expect(getJiraStatusTone('done')).toBe(
      'border-emerald-500/30 bg-emerald-500/10 text-emerald-700 dark:text-emerald-200'
    )
  })

  it('uses the sky tone for the indeterminate category', () => {
    expect(getJiraStatusTone('indeterminate')).toBe(
      'border-sky-500/30 bg-sky-500/10 text-sky-700 dark:text-sky-200'
    )
  })

  const neutral = ['new', 'undefined', '', 'Done', 'DONE', 'in-progress']
  for (const categoryKey of neutral) {
    it(`uses the neutral tone for "${categoryKey}"`, () => {
      // characterization: current behavior — the match is exact and case-sensitive.
      expect(getJiraStatusTone(categoryKey)).toBe(
        'border-border/50 bg-muted/40 text-muted-foreground'
      )
    })
  }
})
