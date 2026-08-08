import { terminalPaneGenerationKey } from './terminal-session-authority-identity'
import type { TerminalPaneAuthorityRecord } from './terminal-session-authority-mutation'

export function reclaimSupersededTerminalAuthorityPanes(
  panes: Map<string, TerminalPaneAuthorityRecord>,
  latestPaneByKey: ReadonlyMap<string, TerminalPaneAuthorityRecord>
): void {
  for (const [key, pane] of panes) {
    if (
      pane.status === 'superseded' &&
      latestPaneByKey.get(pane.paneKey)?.paneGenerationId !== pane.paneGenerationId
    ) {
      panes.delete(key)
    }
  }
}

export function sortTerminalAuthorityPanes(
  panes: Iterable<TerminalPaneAuthorityRecord>
): TerminalPaneAuthorityRecord[] {
  return [...panes].sort((left, right) =>
    terminalPaneGenerationKey(left).localeCompare(terminalPaneGenerationKey(right))
  )
}
