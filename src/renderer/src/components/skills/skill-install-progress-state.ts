import { useEffect, useRef, useState } from 'react'

const INSTALL_PHASE_LABELS = {
  authorizing: 'Authorizing package access…',
  installing: 'Downloading, verifying, and installing…'
} as const

export function useSkillInstallProgress(): {
  activeOperationId: string | null
  phaseLabel: string | null
  begin: (operationId: string) => void
  finish: () => void
} {
  const [activeOperationId, setActiveOperationId] = useState<string | null>(null)
  const activeOperationIdRef = useRef<string | null>(null)
  const [phase, setPhase] = useState<keyof typeof INSTALL_PHASE_LABELS | null>(null)

  useEffect(
    () =>
      window.api.skills.onInstallProgress((progress) => {
        if (progress.operationId === activeOperationIdRef.current) {
          setPhase(progress.phase)
        }
      }),
    []
  )

  return {
    activeOperationId,
    phaseLabel: phase ? INSTALL_PHASE_LABELS[phase] : null,
    begin: (operationId) => {
      activeOperationIdRef.current = operationId
      setActiveOperationId(operationId)
      setPhase('authorizing')
    },
    finish: () => {
      activeOperationIdRef.current = null
      setActiveOperationId(null)
      setPhase(null)
    }
  }
}
