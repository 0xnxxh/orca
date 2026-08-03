import { readdirSync, readFileSync } from 'node:fs'
import { join, sep } from 'node:path'
import { describe, expect, it } from 'vitest'

// The marker sweep that found the dropped-`isComposing` adapters is blind to this defect: the
// markers are present and the guard is called, just one branch too late. A marked Enter or Escape
// can commit a candidate, so application dispatch must wait until composition finishes.
//
// Ordering is a property of the source, not of any one component's behaviour, so it is pinned
// here once rather than re-tested in every composer that happens to handle Escape.
// It enforces textual guard-first order, including equivalent `||` bails, so the heuristic has
// one auditable source shape instead of approximating short-circuit control flow.

const ROOTS = ['src/renderer/src', 'src/main', 'src/shared']
const GUARD = 'isImeCompositionKeyDown'
const ESCAPE_COMPARISON = /[!=]==\s*['"]Escape['"]/
const COMPOSITION_DISPATCH_COMPARISON =
  /[!=]==\s*['"](?:Enter|Escape)['"]|\[[^\]]*['"](?:Enter|Escape)['"][^\]]*\]\.includes\([^)]*\.key\)/
// Ordering alone cannot see a second, wholly unguarded handler added below a guarded one,
// so files this work reviewed are additionally checked for absence — a guard in one handler no
// longer vouches for the rest of the file.
const MUST_GUARD_EVERY_DISPATCH_HANDLER = new Set([
  'src/renderer/src/components/LinearIssueTextEditor.tsx',
  'src/renderer/src/components/LinearIssueWorkspace.tsx',
  'src/renderer/src/components/LinearItemDrawer.tsx',
  'src/renderer/src/components/TerminalSearch.tsx',
  'src/renderer/src/components/NewWorkspaceComposerModal.tsx',
  'src/renderer/src/components/browser-pane/BrowserAddressBar.tsx',
  'src/renderer/src/components/browser-pane/BrowserFind.tsx',
  'src/renderer/src/components/browser-pane/BrowserPane.tsx',
  'src/renderer/src/components/diff-comments/DiffCommentPopover.tsx',
  'src/renderer/src/components/editor/EditorPanelHeaderPath.tsx',
  'src/renderer/src/components/editor/MarkdownPreview.tsx',
  'src/renderer/src/components/editor/PdfFind.tsx',
  'src/renderer/src/components/editor/RichMarkdownLinkBubble.tsx',
  'src/renderer/src/components/editor/RichMarkdownSearchBar.tsx',
  'src/renderer/src/components/editor/UntitledFileRenameDialog.tsx',
  'src/renderer/src/components/editor/useRichMarkdownSearch.ts',
  'src/renderer/src/components/github/GitHubMarkdownComposer.tsx',
  'src/renderer/src/components/github-project/ProjectPicker.tsx',
  'src/renderer/src/components/github-project/ProjectCell.tsx',
  'src/renderer/src/components/github-project/slug-dialog/SlugDialogBody.tsx',
  'src/renderer/src/components/mobile/use-mobile-page-escape.ts',
  'src/renderer/src/components/native-chat/NativeChatQuestionCard.tsx',
  'src/renderer/src/components/network/CustomAddressDialog.tsx',
  'src/renderer/src/components/new-workspace/ProjectCombobox.tsx',
  'src/renderer/src/components/right-sidebar/ChecksPanel.tsx',
  'src/renderer/src/components/right-sidebar/FileExplorerRow.tsx',
  'src/renderer/src/components/right-sidebar/source-control-header-toolbar.tsx',
  'src/renderer/src/components/right-sidebar/useFileSearchPanel.ts',
  'src/renderer/src/components/settings/AgentsPane.tsx',
  'src/renderer/src/components/settings/SettingsFormControls.tsx',
  'src/renderer/src/components/settings/codex-session-source-home-control.tsx',
  'src/renderer/src/components/sidebar/HostRenameDialog.tsx',
  'src/renderer/src/components/sidebar/RemoteFileBrowser.tsx',
  'src/renderer/src/components/sidebar/WorktreeMetaDialog.tsx'
])
const MUST_SCAN = [
  ...MUST_GUARD_EVERY_DISPATCH_HANDLER,
  'src/renderer/src/components/native-chat/use-native-chat-composer-keydown.ts',
  'src/renderer/src/components/new-workspace/SmartWorkspaceNameField.tsx',
  'src/renderer/src/components/settings/ShortcutRecorderButton.tsx',
  'src/renderer/src/components/sidebar/WorkspaceKanbanSearchField.tsx',
  'src/renderer/src/lib/task-page-window-shortcut-policy.ts'
]

function sourceFiles(dir: string): string[] {
  const found: string[] = []
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const path = join(dir, entry.name)
    if (entry.isDirectory()) {
      if (entry.name !== 'node_modules' && entry.name !== '__snapshots__') {
        found.push(...sourceFiles(path))
      }
      continue
    }
    if (!/\.tsx?$/.test(entry.name) || /\.(test|spec)\.tsx?$/.test(entry.name)) {
      continue
    }
    found.push(path)
  }
  return found
}

// A body brace never follows `(`, `,`, `:` or `=`; those introduce a destructured parameter list,
// a JSX expression container, or an object type — all of which open with `{` and would otherwise
// be brace-matched in place of the body. Returns -1 for a handler passed by name, where the
// expression closes before any body opens.
function bodyBrace(source: string, from: number): number {
  let skipped = 0
  for (let i = from; i < source.length; i++) {
    if (source[i] === '{') {
      let before = i - 1
      while (before >= 0 && /\s/.test(source[before])) {
        before--
      }
      if (!'(,:='.includes(source[before])) {
        return i
      }
      skipped++
      continue
    }
    if (source[i] === '}') {
      if (skipped === 0) {
        return -1
      }
      skipped--
    }
  }
  return -1
}

// Returns every function body in `source`, including inline JSX keydown handlers.
function functionBodies(source: string): string[] {
  const bodies: string[] = []
  const starts =
    /(?:on|handle)KeyDown(?:Capture)?\s*[:=]|(?:function|const)\s+\w+\s*[=(]|addEventListener\(\s*['"]keydown['"]\s*,\s*(?:async\s*)?(?:\([^)]*\)|\w+)\s*=>/g
  for (let match = starts.exec(source); match !== null; match = starts.exec(source)) {
    const open = bodyBrace(source, match.index + match[0].length)
    if (open === -1) {
      continue
    }
    let depth = 0
    for (let i = open; i < source.length; i++) {
      if (source[i] === '{') {
        depth++
      } else if (source[i] === '}') {
        depth--
        if (depth === 0) {
          bodies.push(source.slice(open, i + 1))
          break
        }
      }
    }
  }
  return bodies
}

function bodyDispatchesBeforeGuard(body: string, requiresGuard: boolean): boolean {
  const guardAt = body.indexOf(GUARD)
  const dispatchAt = body.search(
    requiresGuard ? COMPOSITION_DISPATCH_COMPARISON : ESCAPE_COMPARISON
  )
  return (
    dispatchAt !== -1 &&
    ((requiresGuard && guardAt === -1) || (guardAt !== -1 && dispatchAt < guardAt))
  )
}

describe('composition guards sit above Enter and Escape dispatch', () => {
  const offenders = new Set<string>()
  for (const root of ROOTS) {
    for (const file of sourceFiles(root)) {
      const source = readFileSync(file, 'utf8')
      if (!source.includes(GUARD) || !COMPOSITION_DISPATCH_COMPARISON.test(source)) {
        continue
      }
      for (const body of functionBodies(source)) {
        const relativeFile = file.split(sep).join('/')
        const requiresGuard = MUST_GUARD_EVERY_DISPATCH_HANDLER.has(relativeFile)
        if (bodyDispatchesBeforeGuard(body, requiresGuard)) {
          offenders.add(file)
        }
      }
    }
  }

  it('finds no reviewed keydown handler that dispatches before consulting the guard', () => {
    expect([...offenders]).toEqual([])
  })

  it('catches a later unguarded handler and anonymous listener in a guarded file', () => {
    const source = `
      const handleKeyDown = (event) => {
        if (isImeCompositionKeyDown(event)) return
        if (event.key === 'Escape') close()
      }
      const handleOtherKeyDown = (event) => {
        if (event.key === 'Enter') submit()
      }
      window.addEventListener('keydown', (event) => {
        if (['Escape'].includes(event.key)) close()
      })
    `

    expect(
      functionBodies(source).filter((body) => bodyDispatchesBeforeGuard(body, true))
    ).toHaveLength(2)
  })

  // A scanner that parses nothing reports zero offenders forever, so the coverage it claims is
  // asserted by name. MUST_SCAN holds the handler shapes the brace matcher has actually got wrong:
  // a hook whose destructured parameter list opens before its body, an inline JSX arrow, and a
  // named callback. A parser regression fails here naming the file it stopped seeing.
  it('actually scanned the guarded keydown handlers it claims to cover', () => {
    const scanned = ROOTS.flatMap(sourceFiles)
      .filter((file) => {
        const source = readFileSync(file, 'utf8')
        return source.includes(GUARD) && functionBodies(source).some((body) => body.includes(GUARD))
      })
      .map((file) => file.split(sep).join('/'))

    expect(scanned).toEqual(expect.arrayContaining(MUST_SCAN))
  })
})
