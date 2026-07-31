import { useRef, useCallback, forwardRef, useImperativeHandle, useEffect, useMemo } from 'react'
import { Platform, View } from 'react-native'
import { WebView, type WebViewMessageEvent } from 'react-native-webview'
import type { TerminalOscLinkRange } from './terminal-osc-link-ranges'
import type { TerminalWebViewHandle, TerminalWebViewProps } from './terminal-webview-contract'
import {
  TerminalWebViewEngineErrorOverlay,
  useTerminalWebViewEngineErrorState
} from './terminal-webview-engine-error-state'
import { TERMINAL_WEBVIEW_FRAME_STYLES } from './terminal-webview-frame-styles'
import { useTerminalWebReadyWatchdog } from './terminal-webview-ready-watchdog'
import { XTERM_WEBVIEW_SOURCE } from './terminal-webview-html'
import type { TerminalWebViewCommand } from './terminal-webview-messages'
import { createTerminalWebViewPendingMessages } from './terminal-webview-pending-messages'
import { dispatchTerminalWebViewNotification } from './terminal-webview-notification-dispatch'
import { routeTerminalQueryReply } from './terminal-webview-query-reply-routing'
import { createTerminalWriteCoalescer } from './terminal-write-coalescer'

type Props = TerminalWebViewProps

export type { TerminalWebViewHandle } from './terminal-webview-contract'

export const TerminalWebView = forwardRef<TerminalWebViewHandle, Props>(function TerminalWebView(
  {
    style,
    terminalTheme,
    textScale = 1,
    onWebReady,
    onEngineError,
    onSelectionMode,
    onSelectionCopy,
    onSelectionEvicted,
    onModesChanged,
    onKeyboardAvoidanceMetrics,
    onHaptic,
    onTerminalInput,
    onTerminalQueryReply,
    onTerminalTap,
    onFileTap,
    onOpenUrl,
    onTextScaleChange
  },
  ref
) {
  const webViewRef = useRef<WebView>(null)
  const isWebReadyRef = useRef(false)
  const pendingMessages = useMemo(() => createTerminalWebViewPendingMessages(), [])
  const messageIdRef = useRef(0)
  const pendingPingIdRef = useRef<number | null>(null)
  const terminalThemeKey = useMemo(() => JSON.stringify(terminalTheme ?? null), [terminalTheme])
  const measureResolveRef = useRef<
    ((result: { cols: number; rows: number } | null) => void) | null
  >(null)
  const renderReadyGenerationRef = useRef(0)
  const renderReadyRef = useRef<{
    generation: number
    promise: Promise<boolean>
    resolve: (ready: boolean) => void
  } | null>(null)
  const cancelRenderReady = useCallback(() => {
    const pending = renderReadyRef.current
    renderReadyGenerationRef.current += 1
    renderReadyRef.current = null
    pending?.resolve(false)
  }, [])
  const { clearEngineError, engineError, reportEngineError, reportNativeEngineError } =
    useTerminalWebViewEngineErrorState(onEngineError)
  const { armWebReadyWatchdog, clearWebReadyWatchdog } = useTerminalWebReadyWatchdog(
    isWebReadyRef,
    reportEngineError
  )

  const sendToWebView = useCallback((msg: TerminalWebViewCommand) => {
    messageIdRef.current += 1
    const id = messageIdRef.current
    webViewRef.current?.postMessage(JSON.stringify({ ...msg, id }))
    return id
  }, [])

  const flushPendingMessages = useCallback(() => {
    pendingMessages.flush(sendToWebView)
  }, [pendingMessages, sendToWebView])

  const postMessage = useCallback(
    (msg: TerminalWebViewCommand) => {
      if (!isWebReadyRef.current) {
        pendingMessages.queue(msg)
        return
      }
      sendToWebView(msg)
    },
    [pendingMessages, sendToWebView]
  )

  // Why: a busy PTY delivers ~200 stream frames/s; coalescing here collapses the
  // per-frame bridge + WebKit IPC + paint cost that runs the phone hot (#9302).
  const writeCoalescer = useMemo(
    () => createTerminalWriteCoalescer((data) => postMessage({ type: 'write', data })),
    [postMessage]
  )

  useEffect(() => {
    return () => {
      cancelRenderReady()
      writeCoalescer.clear()
    }
  }, [cancelRenderReady, writeCoalescer])

  const confirmWebReady = useCallback(
    (notifyParent: boolean) => {
      pendingPingIdRef.current = null
      isWebReadyRef.current = true
      clearWebReadyWatchdog()
      clearEngineError()
      if (notifyParent) {
        onWebReady?.()
      }
      // Why: reload clears queued commands, so readiness must always restore the
      // native-selected theme even when its value did not change in React.
      sendToWebView({ type: 'set-theme', terminalTheme })
      flushPendingMessages()
    },
    [
      clearEngineError,
      clearWebReadyWatchdog,
      flushPendingMessages,
      onWebReady,
      sendToWebView,
      terminalTheme
    ]
  )

  const handleMessage = useCallback(
    (event: WebViewMessageEvent) => {
      let msg: Record<string, unknown>
      try {
        msg = JSON.parse(event.nativeEvent.data) as Record<string, unknown>
      } catch {
        return
      }
      routeTerminalQueryReply(msg, onTerminalQueryReply)

      if (msg.type === 'web-ready') {
        confirmWebReady(true)
      } else if (
        msg.type === 'pong' &&
        typeof msg.pingId === 'number' &&
        msg.pingId === pendingPingIdRef.current
      ) {
        confirmWebReady(false)
      } else if (msg.type === 'render-ready') {
        const pending = renderReadyRef.current
        if (
          typeof msg.generation !== 'number' ||
          pending?.generation !== msg.generation ||
          renderReadyGenerationRef.current !== msg.generation
        ) {
          return
        }
        renderReadyRef.current = null
        pending.resolve(true)
      } else if (msg.type === 'measure-result') {
        const resolve = measureResolveRef.current
        measureResolveRef.current = null
        if (resolve) {
          const cols = typeof msg.cols === 'number' ? msg.cols : null
          const rows = typeof msg.rows === 'number' ? msg.rows : null
          resolve(cols && rows && cols >= 20 && rows >= 8 ? { cols, rows } : null)
        }
      } else {
        dispatchTerminalWebViewNotification(msg, {
          reportEngineError,
          onSelectionMode,
          onSelectionCopy,
          onSelectionEvicted,
          onModesChanged,
          onKeyboardAvoidanceMetrics,
          onHaptic,
          onTerminalInput,
          onTerminalTap,
          onFileTap,
          onOpenUrl,
          onTextScaleChange
        })
      }
    },
    [
      confirmWebReady,
      reportEngineError,
      onSelectionMode,
      onSelectionCopy,
      onSelectionEvicted,
      onModesChanged,
      onKeyboardAvoidanceMetrics,
      onHaptic,
      onTerminalInput,
      onTerminalQueryReply,
      onTerminalTap,
      onFileTap,
      onOpenUrl,
      onTextScaleChange
    ]
  )

  const handleLoadStart = useCallback(() => {
    cancelRenderReady()
    isWebReadyRef.current = false
    pendingPingIdRef.current = null
    armWebReadyWatchdog()
    // Why: messages queued for a previous WebView generation are stale after a reload;
    // dropping them avoids replaying terminal chunks before the next init snapshot.
    pendingMessages.clear()
    writeCoalescer.clear()
  }, [armWebReadyWatchdog, cancelRenderReady, pendingMessages, writeCoalescer])

  const handleReload = useCallback(() => {
    handleLoadStart()
    clearEngineError()
    webViewRef.current?.reload()
  }, [clearEngineError, handleLoadStart])

  const handleContentProcessDidTerminate = useCallback(() => {
    // Why: WKWebView content-process loss is recoverable; stale commands belong
    // to the dead document and the replacement must prove readiness before replay.
    isWebReadyRef.current = false
    cancelRenderReady()
    pendingPingIdRef.current = null
    pendingMessages.clear()
    writeCoalescer.clear()
    clearEngineError()
    armWebReadyWatchdog()
    webViewRef.current?.reload()
  }, [armWebReadyWatchdog, cancelRenderReady, clearEngineError, pendingMessages, writeCoalescer])

  useEffect(() => {
    postMessage({ type: 'set-theme', terminalTheme })
  }, [postMessage, terminalThemeKey, terminalTheme])

  // Why: live-apply text-size changes to an already-mounted terminal (the pane
  // stays alive while the user visits Settings), so no terminal reload is needed.
  useEffect(() => {
    postMessage({ type: 'set-font-scale', fontScale: textScale })
  }, [postMessage, textScale])

  useImperativeHandle(
    ref,
    () => ({
      prepareForForegroundRecovery() {
        if (Platform.OS !== 'ios') {
          return
        }
        // Why: direct ping is the only command allowed through while readiness is
        // invalid; init/write commands queue until this exact document answers.
        isWebReadyRef.current = false
        armWebReadyWatchdog()
        pendingPingIdRef.current = sendToWebView({ type: 'ping' })
      },
      write(data: string) {
        writeCoalescer.write(data)
      },
      init(
        cols: number,
        rows: number,
        initialData?: string,
        preserveScroll?: boolean,
        oscLinks?: TerminalOscLinkRange[]
      ) {
        renderReadyRef.current?.resolve(false)
        renderReadyGenerationRef.current += 1
        const generation = renderReadyGenerationRef.current
        let resolveReady!: (ready: boolean) => void
        const promise = new Promise<boolean>((resolve) => {
          resolveReady = resolve
        })
        renderReadyRef.current = { generation, promise, resolve: resolveReady }
        // Why: pending chunks are pre-snapshot data; the init snapshot supersedes
        // them, and writing them after init would corrupt the fresh buffer.
        writeCoalescer.clear()
        postMessage({
          type: 'init',
          cols,
          rows,
          initialData,
          oscLinks,
          terminalTheme,
          fontScale: textScale,
          preserveScroll,
          renderReadyGeneration: generation
        })
        return generation
      },
      resize(cols: number, rows: number) {
        // Why: resize/reflow must observe all prior writes or bytes reorder.
        writeCoalescer.flushNow()
        postMessage({ type: 'resize', cols, rows })
      },
      reflow(cols: number, rows: number) {
        writeCoalescer.flushNow()
        postMessage({ type: 'reflow', cols, rows })
      },
      clear() {
        writeCoalescer.clear()
        postMessage({ type: 'clear' })
      },
      measureFitDimensions(
        containerHeight?: number
      ): Promise<{ cols: number; rows: number } | null> {
        if (!isWebReadyRef.current) {
          return Promise.resolve(null)
        }
        return new Promise((resolve) => {
          measureResolveRef.current?.(null)
          let timeout: ReturnType<typeof setTimeout> | null = null
          const finish = (result: { cols: number; rows: number } | null) => {
            if (timeout) {
              clearTimeout(timeout)
              timeout = null
            }
            if (measureResolveRef.current === finish) {
              measureResolveRef.current = null
            }
            resolve(result)
          }
          measureResolveRef.current = finish
          sendToWebView({ type: 'measure', containerHeight })
          // Why: if the WebView doesn't respond within 2s (e.g., xterm
          // failed to load), resolve null so the caller can disable
          // Fit to Phone rather than hanging indefinitely.
          timeout = setTimeout(() => {
            if (measureResolveRef.current === finish) {
              finish(null)
            }
          }, 2000)
        })
      },
      resetZoom() {
        postMessage({ type: 'reset-zoom' })
      },
      cancelSelect() {
        postMessage({ type: 'cancel-select' })
      },
      doSelectAll() {
        postMessage({ type: 'do-select-all' })
      },
      isRenderReadyGenerationCurrent(generation: number): boolean {
        return renderReadyGenerationRef.current === generation
      },
      async awaitRenderReady(generation: number): Promise<boolean> {
        const pending = renderReadyRef.current
        if (
          renderReadyGenerationRef.current !== generation ||
          (pending != null && pending.generation !== generation)
        ) {
          return false
        }
        if (!pending) {
          return true
        }
        return new Promise<boolean>((resolve) => {
          let settled = false
          const timeout = setTimeout(() => {
            settled = true
            resolve(false)
          }, 3000)
          void pending.promise.then((ready) => {
            if (!settled) {
              clearTimeout(timeout)
              settled = true
              resolve(ready)
            }
          })
        })
      }
    }),
    [armWebReadyWatchdog, postMessage, sendToWebView, terminalTheme, textScale, writeCoalescer]
  )

  return (
    <View style={[TERMINAL_WEBVIEW_FRAME_STYLES.container, style]}>
      <WebView
        ref={webViewRef}
        source={XTERM_WEBVIEW_SOURCE}
        style={TERMINAL_WEBVIEW_FRAME_STYLES.webview}
        originWhitelist={['*']}
        javaScriptEnabled
        scrollEnabled={false}
        // Why: Android parent gesture containers can intercept vertical drags
        // before the injected xterm scroll router sees them.
        nestedScrollEnabled
        scalesPageToFit={false}
        // Why: Android WebView defaults textZoom to the system font scale, inflating
        // xterm's DOM glyphs past its canvas-measured cell grid (#4579). iOS ignores it.
        textZoom={100}
        onLoadStart={handleLoadStart}
        onMessage={handleMessage}
        onError={(event) => reportNativeEngineError('Terminal WebView load failed', event)}
        onHttpError={(event) => reportNativeEngineError('Terminal WebView HTTP error', event)}
        onRenderProcessGone={(event) =>
          reportNativeEngineError('Terminal WebView render process ended', event)
        }
        onContentProcessDidTerminate={handleContentProcessDidTerminate}
      />
      {engineError ? (
        <TerminalWebViewEngineErrorOverlay message={engineError} onReload={handleReload} />
      ) : null}
    </View>
  )
})
