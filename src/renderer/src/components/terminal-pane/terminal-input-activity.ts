import { makePaneKey } from '../../../../shared/stable-pane-id'
import { useAppStore } from '@/store'

type TerminalUserInputCheckpoint = {
  receivedInputFor: (ptyId: string, paneKey?: string | null) => boolean
  dispose: () => void
}

let userInputGeneration = 0
let activeCheckpointCount = 0
const latestUserInputGenerationByPtyId = new Map<string, number>()
const latestUserInputGenerationByPaneKey = new Map<string, number>()

export function createTerminalUserInputCheckpoint(): TerminalUserInputCheckpoint {
  const generation = userInputGeneration
  let disposed = false
  activeCheckpointCount += 1
  return {
    receivedInputFor: (ptyId, paneKey) =>
      !disposed &&
      ((latestUserInputGenerationByPtyId.get(ptyId) ?? 0) > generation ||
        Boolean(paneKey && (latestUserInputGenerationByPaneKey.get(paneKey) ?? 0) > generation)),
    dispose: () => {
      if (disposed) {
        return
      }
      disposed = true
      activeCheckpointCount -= 1
      if (activeCheckpointCount === 0) {
        latestUserInputGenerationByPtyId.clear()
        latestUserInputGenerationByPaneKey.clear()
      }
    }
  }
}

export function markTerminalUserInputForPtyId(
  ptyId: string | null | undefined,
  paneKey?: string | null
): void {
  if (activeCheckpointCount === 0 || (!ptyId && !paneKey)) {
    return
  }
  userInputGeneration += 1
  if (ptyId) {
    latestUserInputGenerationByPtyId.set(ptyId, userInputGeneration)
  }
  if (paneKey) {
    latestUserInputGenerationByPaneKey.set(paneKey, userInputGeneration)
  }
}

export function recordTerminalUserInputForLeaf(
  tabId: string,
  leafId: string,
  ptyId?: string | null
): void {
  try {
    const state = useAppStore.getState()
    const layoutPtyId = state.terminalLayoutsByTabId?.[tabId]?.ptyIdsByLeafId?.[leafId]
    const tabPtyIds = state.ptyIdsByTabId?.[tabId] ?? []
    const paneKey = makePaneKey(tabId, leafId)
    markTerminalUserInputForPtyId(
      ptyId ?? layoutPtyId ?? (tabPtyIds.length === 1 ? tabPtyIds[0] : null),
      paneKey
    )
    // Why: hibernation must see all user-authorized terminal writes, including
    // sends that bypass xterm.onData.
    state.recordTerminalInput(paneKey)
  } catch {
    // Legacy/malformed layouts are ignored; hibernation remains conservative
    // when it cannot match live PTYs to stable pane keys.
  }
}
