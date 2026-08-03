import React from 'react'
import { cn } from '@/lib/utils'

// Why: one animation-delay write at mount aligns every ring to a shared 1s
// epoch — the phase sync the retired JS clock provided, without its per-tick
// main-thread style writes (STA-3328). No cleanup needed: the value is inert.
function syncSpinnerPhase(el: HTMLSpanElement | null): void {
  if (el === null) {
    return
  }
  const now = document.timeline?.currentTime
  if (typeof now === 'number') {
    el.style.animationDelay = `${-(now % 1000)}ms`
  }
}

// Why: the working-state ring animates via CSS (.agent-working-spinner in
// main.css) so rotation runs on the compositor and never touches the input
// thread. Callers size it via className (size-2 etc.).
export function AgentWorkingSpinner({ className }: { className?: string }): React.JSX.Element {
  return (
    <span
      ref={syncSpinnerPhase}
      data-agent-spinner=""
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
