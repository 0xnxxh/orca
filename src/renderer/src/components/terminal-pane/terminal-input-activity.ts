import { makePaneKey } from '../../../../shared/stable-pane-id'
import { useAppStore } from '@/store'

// Why: delayed automatic Enter must yield when real input reaches the same PTY.
const userInputGenerationByPtyId = new Map<string, number>()

export function markTerminalUserInputForPtyId(ptyId: string | null | undefined): void {
  if (!ptyId) {
    return
  }
  userInputGenerationByPtyId.set(ptyId, (userInputGenerationByPtyId.get(ptyId) ?? 0) + 1)
}

export function readTerminalUserInputGeneration(ptyId: string): number {
  return userInputGenerationByPtyId.get(ptyId) ?? 0
}

export function recordTerminalUserInputForLeaf(tabId: string, leafId: string): void {
  try {
    const state = useAppStore.getState()
    const layoutPtyId = state.terminalLayoutsByTabId?.[tabId]?.ptyIdsByLeafId?.[leafId]
    const tabPtyIds = state.ptyIdsByTabId?.[tabId] ?? []
    markTerminalUserInputForPtyId(layoutPtyId ?? (tabPtyIds.length === 1 ? tabPtyIds[0] : null))
    // Why: hibernation must see all user-authorized terminal writes, including
    // sends that bypass xterm.onData.
    state.recordTerminalInput(makePaneKey(tabId, leafId))
  } catch {
    // Legacy/malformed layouts are ignored; hibernation remains conservative
    // when it cannot match live PTYs to stable pane keys.
  }
}
