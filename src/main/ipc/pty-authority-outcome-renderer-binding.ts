import type { BrowserWindow, WebContents } from 'electron'
import {
  TERMINAL_AUTHORITY_APP_PROJECTION_EVENT,
  type TerminalAuthorityAppProjectionDelta
} from '../../shared/terminal-authority-app-projection'
import type { PtyAuthorityProjectionBroker } from './pty-authority-projection-broker'

type NavigationHandler = (
  event: Electron.Event,
  url: string,
  isSameDocument: boolean,
  isMainFrame: boolean
) => void

type BoundRenderer = Readonly<{
  webContents: WebContents
  didStartNavigation: NavigationHandler
  renderProcessGone: () => void
  destroyed: () => void
}>

/** Owns renderer event listeners so projection IPC can survive navigation and process loss. */
export class PtyAuthorityOutcomeRendererBinding {
  private boundRenderer: BoundRenderer | null = null

  constructor(private readonly broker: PtyAuthorityProjectionBroker) {}

  bind(mainWindow: BrowserWindow): void {
    this.clear()
    const webContents = mainWindow.webContents
    this.broker.attachRenderer(webContents, (delta: TerminalAuthorityAppProjectionDelta) => {
      if (
        mainWindow.isDestroyed() ||
        (typeof webContents.isDestroyed === 'function' && webContents.isDestroyed())
      ) {
        throw new Error('terminal_authority_renderer_unavailable')
      }
      webContents.send(TERMINAL_AUTHORITY_APP_PROJECTION_EVENT, delta)
    })
    const didStartNavigation: NavigationHandler = (_event, _url, isSameDocument, isMainFrame) => {
      if (isMainFrame && !isSameDocument) {
        this.broker.resetRenderer(webContents)
      }
    }
    const renderProcessGone = (): void => this.broker.resetRenderer(webContents)
    const destroyed = (): void => this.broker.detachRenderer(webContents)
    webContents.on('did-start-navigation', didStartNavigation)
    webContents.on('render-process-gone', renderProcessGone)
    webContents.on('destroyed', destroyed)
    this.boundRenderer = Object.freeze({
      webContents,
      didStartNavigation,
      renderProcessGone,
      destroyed
    })
  }

  clear(): void {
    if (!this.boundRenderer) {
      return
    }
    this.broker.detachRenderer(this.boundRenderer.webContents)
    this.boundRenderer.webContents.removeListener(
      'did-start-navigation',
      this.boundRenderer.didStartNavigation
    )
    this.boundRenderer.webContents.removeListener(
      'render-process-gone',
      this.boundRenderer.renderProcessGone
    )
    this.boundRenderer.webContents.removeListener('destroyed', this.boundRenderer.destroyed)
    this.boundRenderer = null
  }
}
