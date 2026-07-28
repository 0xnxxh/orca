export type TccPromptNoticePayload = { promptCount: number }

type MacosTccPromptNoticeApi = {
  onThreshold?: (callback: (payload: TccPromptNoticePayload) => void) => () => void
  consumePending?: () => Promise<TccPromptNoticePayload | null>
}

export function subscribeToMacosTccPromptNotice(
  api: MacosTccPromptNoticeApi | undefined,
  onNotice: (payload: TccPromptNoticePayload) => void
): () => void {
  const consume = (fallback?: TccPromptNoticePayload): void => {
    if (!api?.consumePending) {
      if (fallback) {
        onNotice(fallback)
      }
      return
    }
    void api
      .consumePending()
      .then((pending) => {
        if (pending) {
          onNotice(pending)
        }
      })
      .catch(() => {
        if (fallback) {
          onNotice(fallback)
        }
      })
  }

  const unsubscribe = api?.onThreshold?.((payload) => consume(payload)) ?? (() => {})
  // Why: the threshold can land before React subscribes or while the main window is closed.
  consume()
  // Why: a claimed one-shot must finish through StrictMode cleanup or main would suppress an unseen notice.
  return unsubscribe
}
