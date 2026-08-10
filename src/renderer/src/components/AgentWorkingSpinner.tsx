import React from 'react'
import { cn } from '@/lib/utils'

const SPINNER_ANIMATION_DURATION_MS = 1_000

function getSharedSpinnerAnimationDelay(): string {
  const timelineTime = typeof document === 'undefined' ? null : document.timeline?.currentTime
  return `${-(typeof timelineTime === 'number' ? timelineTime % SPINNER_ANIMATION_DURATION_MS : 0)}ms`
}

// Why: the working-state ring animates via CSS (.agent-working-spinner in
// main.css) so rotation runs on the compositor and never touches the input
// thread. Callers size it via className (size-2 etc.).
export function AgentWorkingSpinner({ className }: { className?: string }): React.JSX.Element {
  return (
    <span
      data-agent-spinner=""
      style={{ animationDelay: getSharedSpinnerAnimationDelay() }}
      className={cn(
        // Why: under reduced motion the animation is disabled, so fill the top
        // border too — a frozen transparent-top ring reads as a broken
        // spinner; a complete ring reads as an intentional static marker (#9515).
        'agent-working-spinner block rounded-full border-2 border-yellow-500 border-t-transparent motion-reduce:border-t-yellow-500',
        className
      )}
    />
  )
}
