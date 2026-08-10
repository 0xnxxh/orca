import { useCallback, useState } from 'react'

export type AgentMapPointerHold = {
  projectId: string | null
  worktreeId: string | null
}

function closestId(target: Element, attribute: string): string | null {
  return target.closest(`[${attribute}]`)?.getAttribute(attribute) ?? null
}

/**
 * Remembers which rings a pan drag started in. Pointer capture retargets
 * `:hover` to the `<svg>` for the whole gesture, so the ring under the pointer
 * would otherwise collapse the moment the drag begins. The hold is released on
 * the first move after the button comes up — the browser recomputes `:hover` in
 * that same event, so the two never both read "not hovered".
 */
export function useAgentMapPointerHold(): {
  held: AgentMapPointerHold | null
  hold: (target: Element) => void
  release: () => void
} {
  const [held, setHeld] = useState<AgentMapPointerHold | null>(null)
  const hold = useCallback((target: Element): void => {
    const projectId = closestId(target, 'data-agent-map-project-id')
    const worktreeId = closestId(target, 'data-agent-map-worktree-id')
    // A pan off empty canvas holds nothing, so leave the memoized scene alone.
    setHeld(projectId === null && worktreeId === null ? null : { projectId, worktreeId })
  }, [])
  const release = useCallback((): void => {
    setHeld((current) => (current === null ? current : null))
  }, [])
  return { held, hold, release }
}
