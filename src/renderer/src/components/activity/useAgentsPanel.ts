import { useCallback, useEffect, useRef, useState } from 'react'
import { CLOSE_AGENTS_PANEL_EVENT, OPEN_AGENTS_PANEL_EVENT } from './agents-panel-events'

const AGENTS_PANEL_ESCAPE_BLOCKING_OVERLAY_SELECTOR = [
  '[data-slot="dropdown-menu-content"][data-state="open"]',
  '[data-slot="context-menu-content"][data-state="open"]',
  '[data-slot="popover-content"][data-state="open"]',
  '[role="dialog"][data-state="open"]:not([data-agents-panel-sheet])',
  '[role="alertdialog"][data-state="open"]',
  '[role="menu"][data-state="open"]',
  '[role="listbox"][data-state="open"]'
].join(', ')

export type AgentsPanelState = {
  agentsPanelOpen: boolean
  openAgentsPanel: () => void
  closeAgentsPanel: () => void
  toggleAgentsPanel: () => void
  handleAgentsPanelOpenChange: (open: boolean) => void
}

export function useAgentsPanel(): AgentsPanelState {
  const [agentsPanelOpen, setAgentsPanelOpen] = useState(false)
  const agentsPanelOpenRef = useRef(agentsPanelOpen)
  agentsPanelOpenRef.current = agentsPanelOpen

  const openAgentsPanel = useCallback(() => {
    if (agentsPanelOpenRef.current) {
      return
    }
    agentsPanelOpenRef.current = true
    setAgentsPanelOpen(true)
  }, [])

  const closeAgentsPanel = useCallback(() => {
    if (!agentsPanelOpenRef.current) {
      return
    }
    agentsPanelOpenRef.current = false
    setAgentsPanelOpen(false)
  }, [])

  const handleAgentsPanelOpenChange = useCallback(
    (open: boolean) => {
      if (open) {
        openAgentsPanel()
        return
      }
      closeAgentsPanel()
    },
    [closeAgentsPanel, openAgentsPanel]
  )

  const toggleAgentsPanel = useCallback(() => {
    if (agentsPanelOpenRef.current) {
      closeAgentsPanel()
      return
    }
    openAgentsPanel()
  }, [closeAgentsPanel, openAgentsPanel])

  useEffect(() => {
    if (!agentsPanelOpen) {
      return
    }

    const handleKeyDown = (event: KeyboardEvent): void => {
      if (event.key !== 'Escape') {
        return
      }
      // Why: Escape should dismiss nested menus/dialogs before this companion panel.
      if (document.querySelector(AGENTS_PANEL_ESCAPE_BLOCKING_OVERLAY_SELECTOR)) {
        return
      }
      event.preventDefault()
      closeAgentsPanel()
    }

    // Why: non-modal companion panel — focus may be outside the sheet when Escape fires.
    document.addEventListener('keydown', handleKeyDown, true)
    return () => document.removeEventListener('keydown', handleKeyDown, true)
  }, [agentsPanelOpen, closeAgentsPanel])

  useEffect(() => {
    const onOpen = (): void => {
      openAgentsPanel()
    }
    const onClose = (): void => {
      closeAgentsPanel()
    }
    window.addEventListener(OPEN_AGENTS_PANEL_EVENT, onOpen)
    window.addEventListener(CLOSE_AGENTS_PANEL_EVENT, onClose)
    return () => {
      window.removeEventListener(OPEN_AGENTS_PANEL_EVENT, onOpen)
      window.removeEventListener(CLOSE_AGENTS_PANEL_EVENT, onClose)
    }
  }, [closeAgentsPanel, openAgentsPanel])

  return {
    agentsPanelOpen,
    openAgentsPanel,
    closeAgentsPanel,
    toggleAgentsPanel,
    handleAgentsPanelOpenChange
  }
}
