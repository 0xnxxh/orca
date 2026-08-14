import type {
  ActiveRightSidebarTab,
  RightSidebarExplorerView
} from '../../../../../../shared/ui-chrome-types'
import type { ActivityBarPosition, EditorViewMode, MarkdownViewMode } from './open-file'

export type EditorChromeSlice = {
  // Why: drafts live in the store (not a hidden mounted EditorPanel, #300) so the editor UI can unmount without losing edits.
  editorDrafts: Record<string, string>
  setEditorDraft: (fileId: string, content: string) => void
  clearEditorDraft: (fileId: string) => void
  clearEditorDrafts: (fileIds: string[]) => void

  // Markdown view mode per file (fileId -> mode)
  markdownViewMode: Record<string, MarkdownViewMode>
  setMarkdownViewMode: (fileId: string, mode: MarkdownViewMode) => void

  // Editor view mode per file (fileId -> mode). Orthogonal to markdownViewMode; absent entry means 'edit'.
  editorViewMode: Record<string, EditorViewMode>
  setEditorViewMode: (fileId: string, mode: EditorViewMode) => void

  // Per-file opt-in to render markdown-preview front matter (#4468); absent = default.
  markdownFrontmatterVisible: Record<string, boolean>
  setMarkdownFrontmatterVisible: (fileId: string, visible: boolean) => void

  // Per-file opt-in to keep the markdown TOC open; absent = hidden (default).
  markdownTableOfContentsVisible: Record<string, boolean>
  setMarkdownTableOfContentsVisible: (fileId: string, visible: boolean) => void

  // Markdown table of contents panel sizing
  markdownTocPanelWidth: number
  setMarkdownTocPanelWidth: (width: number) => void

  // Combined diff file tree sizing
  combinedDiffFileTreeWidth: number
  setCombinedDiffFileTreeWidth: (width: number) => void

  // Right sidebar
  rightSidebarOpen: boolean
  rightSidebarWidth: number
  rightSidebarTab: ActiveRightSidebarTab
  rightSidebarExplorerView: RightSidebarExplorerView
  rightSidebarRouteRequestId: number
  rightSidebarTabByWorktree: Record<string, ActiveRightSidebarTab>
  rightSidebarExplorerViewByWorktree: Record<string, RightSidebarExplorerView>
  activityBarPosition: ActivityBarPosition
  toggleRightSidebar: () => void
  setRightSidebarOpen: (open: boolean) => void
  setRightSidebarWidth: (width: number) => void
  setRightSidebarTab: (tab: ActiveRightSidebarTab) => void
  setRightSidebarExplorerView: (view: RightSidebarExplorerView) => void
  showRightSidebarFiles: () => void
  showRightSidebarSearch: (payload?: {
    query?: string | null
    includePattern?: string | null
  }) => void
  setActivityBarPosition: (position: ActivityBarPosition) => void

  // File explorer state
  expandedDirs: Record<string, Set<string>> // worktreeId -> set of expanded dir paths
  collapseAllDirs: (worktreeId: string) => void
  collapseDirSubtree: (worktreeId: string, dirPath: string) => void
  toggleDir: (worktreeId: string, dirPath: string) => void
  pendingExplorerReveal: {
    worktreeId: string
    filePath: string
    requestId: number
    flash?: boolean
  } | null
  revealInExplorer: (worktreeId: string, filePath: string) => void
  clearPendingExplorerReveal: () => void
}
