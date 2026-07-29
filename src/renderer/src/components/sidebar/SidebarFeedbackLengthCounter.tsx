import React from 'react'
import { cn } from '@/lib/utils'
import { translate } from '@/i18n/i18n'

/** Mirrors the server's cap; over it the endpoint answers 400, not a truncated report. */
export const MAX_FEEDBACK_LENGTH = 5000

// Why: a counter that is always on reads as a word limit to hit. Surface it only
// once the cap is close enough to matter.
const COUNTER_VISIBLE_REMAINING = 500

export function SidebarFeedbackLengthCounter({
  length
}: {
  length: number
}): React.JSX.Element | null {
  const remaining = MAX_FEEDBACK_LENGTH - length
  if (remaining > COUNTER_VISIBLE_REMAINING) {
    return null
  }
  return (
    <span
      className={cn(
        'text-[11px] leading-none',
        remaining > 0 ? 'text-muted-foreground' : 'text-destructive'
      )}
    >
      {translate(
        'auto.components.sidebar.SidebarFeedbackLengthCounter.remaining',
        '{remaining} characters left'
      ).replace('{remaining}', String(Math.max(0, remaining)))}
    </span>
  )
}
