import { useEffect, useRef } from 'react'

// Remote GitHub fan-out needs a longer idle window; Enter still commits immediately.
export const GITHUB_TASK_SEARCH_IDLE_MS = 750

type GitHubTaskSearchCommitOptions = {
  enabled: boolean
  onCommit: (value: string) => void
  value: string
}

export function useGitHubTaskSearchCommit({
  enabled,
  onCommit,
  value
}: GitHubTaskSearchCommitOptions): void {
  const onCommitRef = useRef(onCommit)
  onCommitRef.current = onCommit

  useEffect(() => {
    if (!enabled) {
      return
    }
    const timeout = window.setTimeout(() => onCommitRef.current(value), GITHUB_TASK_SEARCH_IDLE_MS)
    return () => window.clearTimeout(timeout)
  }, [enabled, value])
}
