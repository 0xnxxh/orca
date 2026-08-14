import React from 'react'
import { cn } from '@/lib/utils'

const SPINNER_ANIMATION_NAME = 'agent-spinner-rotate'

// Why: anchoring the Web Animation timeline gives late mounts exact phase sync
// without recurring JS. Driven only by animationstart — a ref-time call would
// force a synchronous style recalc per mount for a phase animationstart fixes
// one frame later anyway (measured: 24ms of blocking work per 200 mounts).
function syncSpinnerPhase(el: HTMLSpanElement | null): void {
  if (el === null || typeof el.getAnimations !== 'function') {
    return
  }

  const animation = el
    .getAnimations()
    .find(
      (candidate) =>
        'animationName' in candidate && candidate.animationName === SPINNER_ANIMATION_NAME
    )
  if (animation !== undefined) {
    animation.startTime = 0
  }
}

function handleSpinnerAnimationStart(event: React.AnimationEvent<HTMLSpanElement>): void {
  if (event.animationName === SPINNER_ANIMATION_NAME) {
    syncSpinnerPhase(event.currentTarget)
  }
}

// Why: the working-state ring animates via CSS (.agent-working-spinner in
// main.css) so rotation runs on the compositor and never touches the input
// thread. Callers size it via className (size-2 etc.).
// `paused` renders the same ring complete and still — the reduced-motion form —
// for work that is running but not in the foreground turn (STA-4119).
export function AgentWorkingSpinner({
  className,
  paused = false
}: {
  className?: string
  paused?: boolean
}): React.JSX.Element {
  return (
    <span
      onAnimationStart={paused ? undefined : handleSpinnerAnimationStart}
      data-agent-spinner=""
      data-agent-spinner-paused={paused ? '' : undefined}
      className={cn(
        'block rounded-full border-2 border-yellow-500',
        // Why: under reduced motion the animation is disabled, so fill the top
        // border too — a frozen transparent-top ring reads as a broken
        // spinner; a complete ring reads as an intentional static marker (#9515).
        paused
          ? 'opacity-70'
          : 'agent-working-spinner border-t-transparent motion-reduce:border-t-yellow-500',
        className
      )}
    />
  )
}
