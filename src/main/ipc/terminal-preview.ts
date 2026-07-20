import { ipcMain } from 'electron'
import type { OrcaRuntimeService } from '../runtime/orca-runtime'

/**
 * Terminal preview for the pop-out dashboard's per-card dialog. Reuses the
 * runtime's per-PTY headless emulator: `serializeTerminalBuffer` paints the
 * current screen instantly, then `subscribeToTerminalData` streams live chunks
 * to the requesting window. It never registers a remote view subscriber, so it
 * can't suppress the model-query responder; keystrokes pass through via
 * `terminalPreview:input`, which honors the mobile-presence lock.
 */
export function registerTerminalPreviewHandlers(runtime: OrcaRuntimeService): void {
  ipcMain.removeHandler('terminalPreview:snapshot')
  ipcMain.removeHandler('terminalPreview:subscribe')
  ipcMain.removeHandler('terminalPreview:unsubscribe')
  ipcMain.removeHandler('terminalPreview:input')

  // webContents.id -> (ptyId -> unsubscribe). Lets us tear a window's streams
  // down when it goes away.
  const subscriptionsByContents = new Map<number, Map<string, () => void>>()

  const disposeContents = (contentsId: number): void => {
    const perPty = subscriptionsByContents.get(contentsId)
    if (!perPty) {
      return
    }
    for (const unsubscribe of perPty.values()) {
      unsubscribe()
    }
    subscriptionsByContents.delete(contentsId)
  }

  ipcMain.handle(
    'terminalPreview:snapshot',
    (_event, args: { ptyId: string; opts?: { scrollbackRows?: number } }) =>
      runtime.serializeTerminalBuffer(args.ptyId, args.opts ?? {})
  )

  ipcMain.handle('terminalPreview:subscribe', (event, args: { ptyId: string }): void => {
    const contents = event.sender
    const contentsId = contents.id
    let perPty = subscriptionsByContents.get(contentsId)
    if (!perPty) {
      perPty = new Map()
      subscriptionsByContents.set(contentsId, perPty)
      contents.once('destroyed', () => disposeContents(contentsId))
    }
    if (perPty.has(args.ptyId)) {
      return
    }
    const unsubscribe = runtime.subscribeToTerminalData(args.ptyId, (data) => {
      if (!contents.isDestroyed()) {
        contents.send('terminalPreview:data', { ptyId: args.ptyId, data })
      }
    })
    perPty.set(args.ptyId, unsubscribe)
  })

  ipcMain.handle(
    'terminalPreview:input',
    (_event, args: { ptyId: string; data: string }): Promise<boolean> => {
      if (typeof args?.ptyId !== 'string' || !args.ptyId || typeof args.data !== 'string') {
        return Promise.resolve(false)
      }
      return runtime.writeTerminalPreviewInput(args.ptyId, args.data)
    }
  )

  ipcMain.handle('terminalPreview:unsubscribe', (event, args: { ptyId: string }): void => {
    const perPty = subscriptionsByContents.get(event.sender.id)
    const unsubscribe = perPty?.get(args.ptyId)
    if (unsubscribe) {
      unsubscribe()
      perPty?.delete(args.ptyId)
    }
  })
}
