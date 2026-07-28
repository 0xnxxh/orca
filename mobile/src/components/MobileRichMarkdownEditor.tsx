import { memo, useCallback, useMemo, useRef } from 'react'
import WebView, { type WebViewMessageEvent } from 'react-native-webview'
import type {
  MobileRichMarkdownEditorProps,
  MobileRichMarkdownEditorTransport
} from './mobile-rich-markdown-editor-contract'
import {
  buildMobileRichMarkdownEditorHtml,
  escapeInjectedJavaScriptString
} from './mobile-rich-markdown-editor-html'
import {
  MobileRichMarkdownEditorPresentation,
  mobileRichMarkdownEditorSurfaceStyle
} from './mobile-rich-markdown-editor-presentation'
import { useMobileRichMarkdownEditorController } from './use-mobile-rich-markdown-editor-controller'

const EDITOR_DOCUMENT_ORIGIN = 'https://orca-mobile-editor.invalid'
const EDITOR_DOCUMENT_URL = `${EDITOR_DOCUMENT_ORIGIN}/rich-markdown-editor`

function MobileRichMarkdownEditorInner({
  content,
  editable,
  onChange,
  onKeyboardInsetChange,
  onOpenLink
}: MobileRichMarkdownEditorProps) {
  const webViewRef = useRef<WebView>(null)
  const html = useMemo(() => buildMobileRichMarkdownEditorHtml(), [])

  const inject = useCallback((script: string) => {
    webViewRef.current?.injectJavaScript(`${script}\ntrue;`)
  }, [])

  const transport = useMemo<MobileRichMarkdownEditorTransport>(
    () => ({
      setMarkdown(markdown, generation) {
        inject(
          `window.__orcaRichMarkdown && window.__orcaRichMarkdown.setMarkdown(${escapeInjectedJavaScriptString(markdown)}, ${generation});`
        )
      },
      setEditable(nextEditable) {
        inject(
          `window.__orcaRichMarkdown && window.__orcaRichMarkdown.setEditable(${nextEditable ? 'true' : 'false'});`
        )
      },
      runCommand(command) {
        inject(
          `window.__orcaRichMarkdown && window.__orcaRichMarkdown.runCommand(${escapeInjectedJavaScriptString(command)});`
        )
      }
    }),
    [inject]
  )
  const { handleMessage, runCommand } = useMobileRichMarkdownEditorController({
    content,
    editable,
    onChange,
    onKeyboardInsetChange,
    onOpenLink,
    transport
  })

  const handleWebViewMessage = useCallback(
    (event: WebViewMessageEvent) => {
      let message: unknown
      try {
        message = JSON.parse(event.nativeEvent.data)
      } catch {
        return
      }
      if (message && typeof message === 'object') {
        handleMessage(message)
      }
    },
    [handleMessage]
  )

  const handleShouldStartLoadWithRequest = useCallback((request: { url?: string }) => {
    const url = request.url ?? ''
    const isEditorDocument =
      url === 'about:blank' ||
      url === EDITOR_DOCUMENT_URL ||
      url.startsWith(`${EDITOR_DOCUMENT_URL}#`)
    // Why: editor content is untrusted markdown; links must leave through openLink.
    return isEditorDocument
  }, [])

  return (
    <MobileRichMarkdownEditorPresentation
      editable={editable}
      onCommand={runCommand}
      editor={
        <WebView
          ref={webViewRef}
          source={{ html, baseUrl: EDITOR_DOCUMENT_URL }}
          originWhitelist={[EDITOR_DOCUMENT_ORIGIN, 'about:blank']}
          javaScriptEnabled
          domStorageEnabled={false}
          hideKeyboardAccessoryView
          keyboardDisplayRequiresUserAction={false}
          onMessage={handleWebViewMessage}
          onShouldStartLoadWithRequest={handleShouldStartLoadWithRequest}
          style={mobileRichMarkdownEditorSurfaceStyle}
          scrollEnabled
          bounces={false}
          nestedScrollEnabled
          setSupportMultipleWindows={false}
          automaticallyAdjustContentInsets={false}
        />
      }
    />
  )
}

export const MobileRichMarkdownEditor = memo(MobileRichMarkdownEditorInner)
