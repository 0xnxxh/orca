import { ipcMain } from 'electron'
import { readGrokAuthSessionAsync, toGrokAccountStatus } from '../rate-limits/grok-auth'

export function registerGrokAccountHandlers(): void {
  ipcMain.handle('grokAccounts:getStatus', async () =>
    toGrokAccountStatus(await readGrokAuthSessionAsync())
  )
}
