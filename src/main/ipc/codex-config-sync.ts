import { ipcMain } from 'electron'
import { getCodexConfigSyncStatus } from '../codex/config-sync-stall'
import type { CodexConfigSyncStatus } from '../../shared/codex-config-sync-types'

/** Registers the read-only IPC channel the settings pane reads once per mount for Codex config sync health. */
export function registerCodexConfigSyncHandlers(): void {
  ipcMain.removeHandler('codexConfigSync:status')
  ipcMain.handle('codexConfigSync:status', (): CodexConfigSyncStatus => getCodexConfigSyncStatus())
}
