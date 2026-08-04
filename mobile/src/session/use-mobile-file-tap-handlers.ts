import { useCallback, useLayoutEffect, useRef, type MutableRefObject } from 'react'
import { useRouter } from 'expo-router'
import { triggerSelection } from '../platform/haptics'
import type { RpcClient } from '../transport/rpc-client'
import { openMobileFileTap, type FileTapSessionTab } from './mobile-file-tap-open'
import { openMobileNativeChatFileTap } from './mobile-native-chat-open-file'

type MobileFileTapHandlerOptions<T extends FileTapSessionTab> = {
  client: Pick<RpcClient, 'sendRequest'> | null
  hostId: string
  worktreeId: string
  worktreeName?: string
  activeHandleRef: MutableRefObject<string | null>
  terminalCwdRef: MutableRefObject<Map<string, string>>
  openBrowser: (url: string) => void
  fetchSessionTabs: () => Promise<void>
  getSessionTabs: () => readonly T[]
  getActiveSessionTabId: () => string | null
  getActiveSessionTabType: () => string | null
  switchSessionTab: (tab: T) => void
  scheduleDelayedAction: (callback: () => void, delayMs: number) => unknown
  /** Surfaces a chat tap that opened nothing. Chat taps happen with the keyboard
   *  up, which covers the toast, so the route routes this to the composer banner. */
  reportChatTapFailure: (message: string) => void
}

/**
 * Tap-to-open handlers for file references, shared by the terminal (link taps
 * with the terminal's cwd) and native chat (worktree-root-relative paths, with
 * failure feedback). Handlers are identity-stable and read the latest options at
 * dispatch time; the shared activation seq lets a newer tap on either surface
 * supersede an in-flight one.
 */
export function useMobileFileTapHandlers<T extends FileTapSessionTab>(
  options: MobileFileTapHandlerOptions<T>
): {
  handleFileTap: (
    handle: string,
    pathText: string,
    line: number | null,
    column: number | null
  ) => void
  handleNativeChatFileTap: (pathText: string) => void
} {
  const router = useRouter()
  const routerRef = useRef(router)
  const optionsRef = useRef(options)
  const activationSeqRef = useRef(0)

  // Mirror the latest options for dispatch-time reads. No dep list: the call site
  // rebuilds its accessor closures every render, so a dep list could never skip —
  // it would only add an array to compare on a route that rerenders per keystroke.
  useLayoutEffect(() => {
    routerRef.current = router
    optionsRef.current = options
  })

  const handleFileTap = useCallback(
    (handle: string, pathText: string, line: number | null, column: number | null) => {
      const current = optionsRef.current
      if (handle !== current.activeHandleRef.current || !current.client) {
        return
      }
      const activationSeq = ++activationSeqRef.current
      openMobileFileTap<T>({
        client: current.client,
        hostId: current.hostId,
        worktreeId: current.worktreeId,
        worktreeName: current.worktreeName,
        terminalHandle: handle,
        pathText,
        cwd: current.terminalCwdRef.current.get(handle) ?? null,
        line,
        column,
        pushPreviewRoute: (href) => routerRef.current.push(href),
        openBrowser: current.openBrowser,
        triggerOpenFeedback: triggerSelection,
        fetchSessionTabs: current.fetchSessionTabs,
        getSessionTabs: current.getSessionTabs,
        getActiveSessionTabId: current.getActiveSessionTabId,
        getActivationState: (activated) => ({
          activated,
          activationSeq,
          latestActivationSeq: activationSeqRef.current,
          sourceTerminalHandle: handle,
          activeTerminalHandle: current.activeHandleRef.current,
          activeTabType: current.getActiveSessionTabType()
        }),
        switchSessionTab: current.switchSessionTab,
        scheduleDelayedAction: current.scheduleDelayedAction
      })
    },
    []
  )

  const handleNativeChatFileTap = useCallback((pathText: string) => {
    const current = optionsRef.current
    // The chat overlay rides on its backing terminal tab; that handle anchors
    // the activation gate even though resolution ignores the terminal's cwd.
    const sourceTerminalHandle = current.activeHandleRef.current
    if (!current.client || !sourceTerminalHandle) {
      return
    }
    const activationSeq = ++activationSeqRef.current
    openMobileNativeChatFileTap<T>({
      client: current.client,
      hostId: current.hostId,
      worktreeId: current.worktreeId,
      worktreeName: current.worktreeName,
      pathText,
      pushPreviewRoute: (href) => routerRef.current.push(href),
      openBrowser: current.openBrowser,
      triggerOpenFeedback: triggerSelection,
      fetchSessionTabs: current.fetchSessionTabs,
      getSessionTabs: current.getSessionTabs,
      getActiveSessionTabId: current.getActiveSessionTabId,
      getActivationState: (activated) => ({
        activated,
        activationSeq,
        latestActivationSeq: activationSeqRef.current,
        sourceTerminalHandle,
        activeTerminalHandle: current.activeHandleRef.current,
        activeTabType: current.getActiveSessionTabType()
      }),
      switchSessionTab: current.switchSessionTab,
      scheduleDelayedAction: current.scheduleDelayedAction,
      onOpenFailed: () => current.reportChatTapFailure(`Couldn't open ${pathText}`)
    })
  }, [])

  return { handleFileTap, handleNativeChatFileTap }
}
