import { shell, type WebContents } from 'electron'
import { is } from '@electron-toolkit/utils'
import { normalizeExternalBrowserUrl } from '../../shared/browser-url'

/**
 * A reload is a renderer-initiated navigation to the document already loaded here, so the
 * blanket guard below strands recovery reloads (lazy-chunk recovery, GH auth retry). Re-entering
 * the same URL grants no privilege the live document does not already hold.
 */
function isOwnDocumentNavigation(contents: WebContents, url: string): boolean {
  try {
    const current = contents.getURL()
    if (!current) {
      return false
    }
    const target = new URL(url)
    const loaded = new URL(current)
    // Hash-only changes never reach will-navigate; ignore the fragment so they cannot differ.
    target.hash = ''
    loaded.hash = ''
    return target.href === loaded.href
  } catch {
    // A destroyed WebContents or malformed URL is never a self-navigation.
    return false
  }
}

/** Keep remote documents from inheriting an Orca window's privileged preload. */
export function installPrivilegedWindowNavigationPolicy(contents: WebContents): void {
  contents.setWindowOpenHandler(({ url }) => {
    const externalUrl = normalizeExternalBrowserUrl(url)
    if (externalUrl) {
      void shell.openExternal(externalUrl)
    }
    return { action: 'deny' }
  })

  contents.on('will-navigate', (event, url) => {
    if (isOwnDocumentNavigation(contents, url)) {
      return
    }
    const externalUrl = normalizeExternalBrowserUrl(url)
    if (externalUrl) {
      if (is.dev && process.env.ELECTRON_RENDERER_URL) {
        try {
          const target = new URL(externalUrl)
          const allowed = new URL(process.env.ELECTRON_RENDERER_URL)
          if (target.origin === allowed.origin) {
            return
          }
        } catch {
          // Fall through and block malformed navigation targets.
        }
      }
      void shell.openExternal(externalUrl)
    }
    event.preventDefault()
  })
}
