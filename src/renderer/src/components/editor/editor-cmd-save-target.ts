import { FLOATING_TERMINAL_WORKTREE_ID } from '../../../../shared/constants'
import type { Tab, TabContentType } from '../../../../shared/types'

export const EDITOR_TAB_CONTENT_TYPES = new Set<TabContentType>([
  'editor',
  'diff',
  'conflict-review',
  'check-details'
])

type EditorCmdSaveState = {
  activeFileId: string | null
  activeTabType: string | null
  getActiveTab: (worktreeId: string) => Tab | null
}

export function getEditorCmdSaveFileId(
  state: EditorCmdSaveState,
  floatingPanelOwnsEvent: boolean
): string | null {
  if (!floatingPanelOwnsEvent) {
    return state.activeTabType === 'editor' ? state.activeFileId : null
  }
  const activeTab = state.getActiveTab(FLOATING_TERMINAL_WORKTREE_ID)
  return activeTab && EDITOR_TAB_CONTENT_TYPES.has(activeTab.contentType)
    ? activeTab.entityId
    : null
}
