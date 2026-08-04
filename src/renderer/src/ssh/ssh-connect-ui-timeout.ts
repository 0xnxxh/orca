import { translate } from '@/i18n/i18n'

// Why: ssh.connect has no built-in timeout, so bound how long a UI control waits on it —
// a stalled backend connect must not leave a disabled spinner stuck forever. The backend
// keeps going regardless.
export const SSH_CONNECT_UI_TIMEOUT_MS = 20_000

export async function withUiConnectTimeout<T>(promise: Promise<T>): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => {
      reject(
        new Error(
          // Key kept from the original NewWorkspaceComposerCard home so existing
          // translations survive the move.
          translate(
            'auto.components.NewWorkspaceComposerCard.connectTimedOut',
            'Connection timed out. It may still be connecting in the background.'
          )
        )
      )
    }, SSH_CONNECT_UI_TIMEOUT_MS)
  })
  try {
    return await Promise.race([promise, timeout])
  } finally {
    if (timer) {
      clearTimeout(timer)
    }
  }
}
