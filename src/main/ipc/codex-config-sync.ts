import { ipcMain } from 'electron'
import { getCodexConfigSyncStatus } from '../codex/config-sync-stall'
import type { CodexConfigSyncStatus } from '../../shared/codex-config-sync-types'

export function registerCodexConfigSyncHandlers(): void {
  ipcMain.removeHandler('codexConfigSync:status')
  ipcMain.handle('codexConfigSync:status', (): CodexConfigSyncStatus => getCodexConfigSyncStatus())
}
