export function readGuestNavigationState(guest: Electron.WebContents): {
  canGoBack: boolean
  canGoForward: boolean
} {
  const history = guest.navigationHistory
  return {
    canGoBack: history?.canGoBack?.() ?? false,
    canGoForward: history?.canGoForward?.() ?? false
  }
}

export async function readGuestCdpNavigationState(
  guest: Electron.WebContents
): Promise<{ canGoBack: boolean; canGoForward: boolean }> {
  try {
    const result = (await guest.debugger.sendCommand('Page.getNavigationHistory')) as {
      currentIndex?: unknown
      entries?: unknown
    }
    if (typeof result.currentIndex === 'number' && Array.isArray(result.entries)) {
      return {
        canGoBack: result.currentIndex > 0,
        canGoForward: result.currentIndex < result.entries.length - 1
      }
    }
  } catch {
    // Electron's navigationHistory remains available if CDP detaches mid-event.
  }
  return readGuestNavigationState(guest)
}
