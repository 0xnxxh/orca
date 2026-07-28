export type TccPromptNoticePayload = { promptCount: number }

type TccPromptNoticeClaim = TccPromptNoticePayload & { claimId?: number }

type MacosTccPromptNoticeApi = {
  onThreshold?: (callback: (payload: TccPromptNoticePayload) => void) => () => void
  consumePending?: () => Promise<TccPromptNoticeClaim | null>
  acknowledgePending?: (claimId: number) => Promise<void>
  releasePending?: (claimId: number) => Promise<void>
}

export function subscribeToMacosTccPromptNotice(
  api: MacosTccPromptNoticeApi | undefined,
  onNotice: (payload: TccPromptNoticePayload) => void
): () => void {
  const releaseClaim = (claimId: number): void => {
    void api?.releasePending?.(claimId).catch(() => {})
  }
  const showNotice = (payload: TccPromptNoticePayload, claimId?: number): boolean => {
    try {
      onNotice(payload)
      return true
    } catch (error) {
      if (claimId !== undefined) {
        releaseClaim(claimId)
      }
      console.error('[macos-tcc-prompts] Failed to show notice:', error)
      return false
    }
  }
  const consume = (fallback?: TccPromptNoticePayload): void => {
    if (!api?.consumePending) {
      if (fallback) {
        showNotice(fallback)
      }
      return
    }
    void api.consumePending().then(
      (pending) => {
        if (pending) {
          const claimId = pending.claimId
          if (!showNotice({ promptCount: pending.promptCount }, claimId)) {
            return
          }
          if (typeof claimId === 'number') {
            if (!api.acknowledgePending) {
              releaseClaim(claimId)
              return
            }
            void api.acknowledgePending(claimId).catch(() => releaseClaim(claimId))
          }
        }
      },
      () => {
        if (fallback) {
          showNotice(fallback)
        }
      }
    )
  }

  const unsubscribe = api?.onThreshold?.((payload) => consume(payload)) ?? (() => {})
  // Why: the threshold can land before React subscribes or while the main window is closed.
  consume()
  // Why: StrictMode cleanup must not abandon a claim before it is acknowledged or released.
  return unsubscribe
}
