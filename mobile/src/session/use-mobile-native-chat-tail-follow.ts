import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react'
import type { NativeScrollEvent, NativeSyntheticEvent } from 'react-native'

const BOTTOM_THRESHOLD = 80
const TAIL_FOLLOW_DELAY_MS = 60

type HistoryRequest = {
  firstMessageId: string | null
  restoreFollowing: boolean
  observedLoading: boolean
  triggeringGesture: number | null
  userIntent: boolean | null
}

type MobileNativeChatTailFollow = {
  atBottom: boolean
  detachTail: () => void
  followTail: (animated: boolean) => void
  followTailAfterLayout: () => void
  onContentSizeChange: (height: number) => void
  onMomentumScrollBegin: () => void
  onMomentumScrollEnd: () => void
  onScroll: (event: NativeSyntheticEvent<NativeScrollEvent>) => void
  onScrollBeginDrag: () => void
  onScrollEndDrag: () => void
  requestHistory: (loadEarlier: () => boolean) => boolean
  requestHistoryFromScroll: (loadEarlier: () => boolean) => boolean
  scheduleTailFollow: () => void
}

export function useMobileNativeChatTailFollow(args: {
  conversationIdentity: string
  firstMessageId: string | null
  loadingEarlier: boolean | undefined
  scrollToEnd: (animated: boolean) => void
}): MobileNativeChatTailFollow {
  const { conversationIdentity, firstMessageId, loadingEarlier, scrollToEnd } = args
  const [atBottom, setAtBottom] = useState(true)
  const followingRef = useRef(true)
  const nearBottomRef = useRef(true)
  const userScrollActiveRef = useRef(false)
  const gestureIdRef = useRef(0)
  const gestureOwnsMomentumRef = useRef(false)
  const detachedGestureIdRef = useRef<number | null>(null)
  const offsetRef = useRef(0)
  const viewportHeightRef = useRef(0)
  const historyRequestRef = useRef<HistoryRequest | null>(null)
  const momentumOwnerTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const tailTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const identityRef = useRef(conversationIdentity)

  const cancelTailFollow = useCallback(() => {
    if (tailTimerRef.current) {
      clearTimeout(tailTimerRef.current)
      tailTimerRef.current = null
    }
  }, [])

  const cancelMomentumOwnerTimer = useCallback(() => {
    if (momentumOwnerTimerRef.current) {
      clearTimeout(momentumOwnerTimerRef.current)
      momentumOwnerTimerRef.current = null
    }
  }, [])

  const scheduleTailFollow = useCallback(() => {
    cancelTailFollow()
    if (!followingRef.current || userScrollActiveRef.current) {
      return
    }
    tailTimerRef.current = setTimeout(() => {
      tailTimerRef.current = null
      if (followingRef.current && !userScrollActiveRef.current) {
        scrollToEnd(true)
      }
    }, TAIL_FOLLOW_DELAY_MS)
  }, [cancelTailFollow, scrollToEnd])

  const attachTailFollow = useCallback(() => {
    if (historyRequestRef.current) {
      historyRequestRef.current.userIntent = true
    }
    cancelMomentumOwnerTimer()
    userScrollActiveRef.current = false
    gestureOwnsMomentumRef.current = false
    detachedGestureIdRef.current = null
    followingRef.current = true
    nearBottomRef.current = true
    setAtBottom(true)
    cancelTailFollow()
  }, [cancelMomentumOwnerTimer, cancelTailFollow])

  const detachTail = useCallback(() => {
    if (historyRequestRef.current) {
      historyRequestRef.current.userIntent = false
    }
    followingRef.current = false
    cancelTailFollow()
  }, [cancelTailFollow])

  const followTail = useCallback(
    (animated: boolean) => {
      attachTailFollow()
      scrollToEnd(animated)
    },
    [attachTailFollow, scrollToEnd]
  )

  const followTailAfterLayout = useCallback(() => {
    attachTailFollow()
    scheduleTailFollow()
  }, [attachTailFollow, scheduleTailFollow])

  const restoreRejectedHistoryRequest = useCallback(
    (request: HistoryRequest) => {
      historyRequestRef.current = null
      followingRef.current = request.restoreFollowing
      if (request.restoreFollowing) {
        scheduleTailFollow()
      }
    },
    [scheduleTailFollow]
  )

  const requestHistory = useCallback(
    (loadEarlier: () => boolean): boolean => {
      if (historyRequestRef.current || loadingEarlier) {
        return false
      }
      const request: HistoryRequest = {
        firstMessageId,
        restoreFollowing: followingRef.current,
        observedLoading: false,
        triggeringGesture: userScrollActiveRef.current ? gestureIdRef.current : null,
        userIntent: null
      }
      historyRequestRef.current = request
      followingRef.current = false
      cancelTailFollow()
      try {
        if (loadEarlier()) {
          return true
        }
      } catch (error) {
        restoreRejectedHistoryRequest(request)
        throw error
      }
      restoreRejectedHistoryRequest(request)
      return false
    },
    [cancelTailFollow, firstMessageId, loadingEarlier, restoreRejectedHistoryRequest]
  )

  const requestHistoryFromScroll = useCallback(
    (loadEarlier: () => boolean): boolean =>
      userScrollActiveRef.current ? requestHistory(loadEarlier) : false,
    [requestHistory]
  )

  useLayoutEffect(() => {
    if (identityRef.current === conversationIdentity) {
      return
    }
    identityRef.current = conversationIdentity
    cancelTailFollow()
    cancelMomentumOwnerTimer()
    historyRequestRef.current = null
    followingRef.current = true
    nearBottomRef.current = true
    userScrollActiveRef.current = false
    gestureOwnsMomentumRef.current = false
    detachedGestureIdRef.current = null
    offsetRef.current = 0
    viewportHeightRef.current = 0
    setAtBottom(true)
    if (firstMessageId !== null) {
      scheduleTailFollow()
    }
  }, [
    cancelMomentumOwnerTimer,
    cancelTailFollow,
    conversationIdentity,
    firstMessageId,
    scheduleTailFollow
  ])

  useLayoutEffect(() => {
    const request = historyRequestRef.current
    if (loadingEarlier) {
      if (request) {
        request.observedLoading = true
      } else {
        historyRequestRef.current = {
          firstMessageId,
          restoreFollowing: followingRef.current,
          observedLoading: true,
          triggeringGesture: userScrollActiveRef.current ? gestureIdRef.current : null,
          userIntent: null
        }
        followingRef.current = false
        cancelTailFollow()
      }
      return
    }
    if (!request?.observedLoading) {
      return
    }
    historyRequestRef.current = null
    const madeProgress = firstMessageId !== request.firstMessageId
    const shouldFollow = request.userIntent ?? (madeProgress ? false : request.restoreFollowing)
    if (madeProgress && request.userIntent === null) {
      detachedGestureIdRef.current = request.triggeringGesture
    }
    followingRef.current = shouldFollow
    if (shouldFollow) {
      scheduleTailFollow()
    }
  }, [cancelTailFollow, firstMessageId, loadingEarlier, scheduleTailFollow])

  const onScroll = useCallback((event: NativeSyntheticEvent<NativeScrollEvent>) => {
    const { contentOffset, contentSize, layoutMeasurement } = event.nativeEvent
    offsetRef.current = contentOffset.y
    viewportHeightRef.current = layoutMeasurement.height
    const distance = contentSize.height - contentOffset.y - layoutMeasurement.height
    const nearBottom = distance < BOTTOM_THRESHOLD
    nearBottomRef.current = nearBottom
    setAtBottom(nearBottom)
  }, [])

  const onScrollBeginDrag = useCallback(() => {
    // Native anchor events update geometry; only a gesture changes follow intent.
    cancelMomentumOwnerTimer()
    detachedGestureIdRef.current = null
    gestureIdRef.current += 1
    gestureOwnsMomentumRef.current = true
    userScrollActiveRef.current = true
    detachTail()
  }, [cancelMomentumOwnerTimer, detachTail])

  const applyGestureEnd = useCallback(() => {
    userScrollActiveRef.current = false
    const request = historyRequestRef.current
    if (
      request?.triggeringGesture === gestureIdRef.current ||
      detachedGestureIdRef.current === gestureIdRef.current
    ) {
      return
    }
    if (request) {
      request.userIntent = nearBottomRef.current
    }
    followingRef.current = nearBottomRef.current
  }, [])

  const onScrollEndDrag = useCallback(() => {
    applyGestureEnd()
    cancelMomentumOwnerTimer()
    momentumOwnerTimerRef.current = setTimeout(() => {
      momentumOwnerTimerRef.current = null
      gestureOwnsMomentumRef.current = false
      detachedGestureIdRef.current = null
    }, 0)
  }, [applyGestureEnd, cancelMomentumOwnerTimer])

  const onMomentumScrollBegin = useCallback(() => {
    if (!gestureOwnsMomentumRef.current) {
      return
    }
    cancelMomentumOwnerTimer()
    userScrollActiveRef.current = true
  }, [cancelMomentumOwnerTimer])

  const onMomentumScrollEnd = useCallback(() => {
    if (!gestureOwnsMomentumRef.current) {
      return
    }
    gestureOwnsMomentumRef.current = false
    applyGestureEnd()
    detachedGestureIdRef.current = null
  }, [applyGestureEnd])

  const onContentSizeChange = useCallback(
    (height: number) => {
      if (followingRef.current && !userScrollActiveRef.current) {
        nearBottomRef.current = true
        setAtBottom(true)
        scrollToEnd(false)
        return
      }
      if (viewportHeightRef.current > 0) {
        const nearBottom = height - offsetRef.current - viewportHeightRef.current < BOTTOM_THRESHOLD
        nearBottomRef.current = nearBottom
        setAtBottom(nearBottom)
      }
    },
    [scrollToEnd]
  )

  useEffect(
    () => () => {
      cancelTailFollow()
      cancelMomentumOwnerTimer()
    },
    [cancelMomentumOwnerTimer, cancelTailFollow]
  )

  return {
    atBottom,
    detachTail,
    followTail,
    followTailAfterLayout,
    onContentSizeChange,
    onMomentumScrollBegin,
    onMomentumScrollEnd,
    onScroll,
    onScrollBeginDrag,
    onScrollEndDrag,
    requestHistory,
    requestHistoryFromScroll,
    scheduleTailFollow
  }
}
