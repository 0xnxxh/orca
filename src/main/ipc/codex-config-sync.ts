import { ipcMain } from 'electron'
import { getCodexConfigSyncStatus } from '../codex/config-sync-stall'
import type { CodexConfigSyncStatus } from '../../shared/codex-config-sync-types'

/** Registers the IPC channel the settings UI polls for Codex config sync health. */
export function registerCodexConfigSyncHandlers(): void {
  ipcMain.removeHandler('codexConfigSync:status')
  ipcMain.handle('codexConfigSync:status', (): CodexConfigSyncStatus => getCodexConfigSyncStatus())
}
