export const OPEN_AGENTS_PANEL_EVENT = 'orca:open-agents-panel'
export const CLOSE_AGENTS_PANEL_EVENT = 'orca:close-agents-panel'

export function requestOpenAgentsPanel(): void {
  if (typeof window === 'undefined') {
    return
  }
  window.dispatchEvent(new Event(OPEN_AGENTS_PANEL_EVENT))
}

export function requestCloseAgentsPanel(): void {
  if (typeof window === 'undefined') {
    return
  }
  window.dispatchEvent(new Event(CLOSE_AGENTS_PANEL_EVENT))
}
