import { ipcMain, type IpcMainInvokeEvent } from 'electron'
import type { MacosPtyLimitService } from '../macos-pty-limit'
import { MacosPtyLimitService as DefaultMacosPtyLimitService } from '../macos-pty-limit'
import { isTrustedUIRenderer } from './ui'

function assertTrustedSender(event: IpcMainInvokeEvent): void {
  if (!isTrustedUIRenderer(event.sender)) {
    throw new Error('Unauthorized macOS PTY limit IPC sender')
  }
}

export function registerMacosPtyLimitHandlers(
  service: MacosPtyLimitService = new DefaultMacosPtyLimitService()
): void {
  ipcMain.handle('macosPtyLimit:getStatus', (event: IpcMainInvokeEvent) => {
    assertTrustedSender(event)
    return service.getStatus()
  })

  ipcMain.handle('macosPtyLimit:increase', (event: IpcMainInvokeEvent) => {
    assertTrustedSender(event)
    return service.increaseToMaximum()
  })
}
