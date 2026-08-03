import { useCallback, useEffect, useRef } from 'react'

type TaskCreationDraftRetentionOptions<Draft> = {
  open: boolean
  draft: Draft
  writeDraft: (draft: Draft | null) => void
}

export function useTaskCreationDraftRetention<Draft>({
  open,
  draft,
  writeDraft
}: TaskCreationDraftRetentionOptions<Draft>): () => void {
  const draftRef = useRef(draft)
  const writeDraftRef = useRef(writeDraft)
  const discardRef = useRef(false)
  writeDraftRef.current = writeDraft
  if (open) {
    draftRef.current = draft
  }

  // Why: closing cleanup captures the latest render once without a global store write per keystroke.
  useEffect(() => {
    if (!open) {
      return
    }
    discardRef.current = false
    return () => {
      if (!discardRef.current) {
        writeDraftRef.current(draftRef.current)
      }
    }
  }, [open])

  return useCallback(() => {
    discardRef.current = true
    writeDraftRef.current(null)
  }, [])
}
