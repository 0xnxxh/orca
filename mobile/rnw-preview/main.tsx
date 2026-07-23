import { createElement as h, useCallback, useMemo, useState } from 'react'
import { createRoot } from 'react-dom/client'
import { ScrollView, StyleSheet, Text, View } from 'react-native'
import { MobileNativeChatComposer } from '../src/session/MobileNativeChatComposer'
import { MobileNativeChatMessage } from '../src/session/MobileNativeChatMessage'
import { useMobileNativeChatDrafts } from '../src/session/use-mobile-native-chat-drafts'
import { useMobileNativeChatImageAttachments } from '../src/session/use-mobile-native-chat-image-attachments'
import {
  buildMobileNativeChatTransientData,
  foldMobileNativeChatMessages
} from '../src/session/mobile-native-chat-render-data'
import type { NativeChatMessage } from '../../src/shared/native-chat-types'
import type { RpcClient } from '../src/transport/rpc-client'
import { colors, radii, spacing } from '../src/theme/mobile-theme'
import { calls, fakeClient } from './fake-rpc'

const TERMINAL = 'term-mock'

const AGENT_MSG: NativeChatMessage = {
  id: 'a1',
  role: 'assistant',
  blocks: [{ type: 'text', text: 'Sure — send me the screenshot and I’ll take a look.' }],
  timestamp: null,
  source: 'transcript'
}

// A tiny stand-in for the controller's handleNativeChatSend: capture the send
// origin, hit the (faked) terminal.send, then record the optimistic echo — the
// real drafts logic, so the sent bubble is produced by the code, not by us.
function useMiniController(messages: NativeChatMessage[]) {
  const drafts = useMobileNativeChatDrafts({
    hostId: 'h',
    worktreeId: 'w',
    tabId: 't',
    sessionId: 's',
    messages
  })
  const baseSend = useCallback(
    async (text: string, images?: string[]): Promise<boolean> => {
      const origin = drafts.captureSendOrigin(text)
      if (!origin) {
        return false
      }
      const resp = await fakeClient.sendRequest('terminal.send', {
        terminal: TERMINAL,
        text,
        enter: true
      })
      if (!(resp.ok && (resp.result as { send?: { accepted?: boolean } })?.send?.accepted)) {
        return false
      }
      drafts.acceptSend(origin, text, images)
      return true
    },
    [drafts]
  )
  return { drafts, baseSend }
}

function App(): React.ReactNode {
  const [messages] = useState<NativeChatMessage[]>([AGENT_MSG])
  const [, forceRender] = useState(0)
  const { drafts, baseSend } = useMiniController(messages)
  const activeHandleRef = useMemo(() => ({ current: TERMINAL as string | null }), [])
  const deviceTokenRef = useMemo(() => ({ current: null as string | null }), [])

  const imagesHook = useMobileNativeChatImageAttachments({
    client: fakeClient as unknown as RpcClient,
    activeHandleRef,
    deviceTokenRef,
    getActiveWorktreeConnectionId: async () => null,
    connState: 'connected',
    enabled: true,
    showToast: () => {},
    baseSend,
    onAttachSuccess: () => {},
    onError: () => {}
  })

  const { data } = useMemo(
    () =>
      buildMobileNativeChatTransientData({
        folded: foldMobileNativeChatMessages(messages),
        pending: drafts.pending
      }),
    [messages, drafts.pending]
  )

  const terminalSends = calls.filter((c) => c.method === 'terminal.send')

  return h(
    View,
    { style: styles.page },
    h(
      Text,
      { style: styles.title },
      'Real native-chat components + hooks — driven by clicks (picker & RPC faked)'
    ),
    h(
      View,
      { style: styles.phone },
      h(Text, { style: styles.header }, 'Claude · rich chat'),
      h(
        ScrollView,
        { style: styles.transcript, contentContainerStyle: styles.tc },
        data.map((m) =>
          h(MobileNativeChatMessage, { key: m.id, message: m, toolsExpanded: false, fontScale: 1 })
        )
      ),
      h(MobileNativeChatComposer, {
        value: drafts.composerText,
        onChangeText: (t: string) => {
          drafts.setComposerText(t)
          forceRender((n) => n + 1)
        },
        onSend: async (t: string) => {
          const ok = await imagesHook.sendNativeChat(t)
          forceRender((n) => n + 1)
          return ok
        },
        onAttachImage: () => {
          void imagesHook.attachImage('library').then(() => forceRender((n) => n + 1))
        },
        attachments: imagesHook.attachments,
        onRemoveAttachment: imagesHook.removeAttachment,
        onMicPress: () => {}
      })
    ),
    // A live trace of what the real send pipeline actually wrote to the (faked)
    // host socket — so the bytes are visible, not asserted.
    h(
      View,
      { style: styles.trace },
      h(Text, { style: styles.traceTitle }, `terminal.send calls (${terminalSends.length}):`),
      terminalSends.map((c, i) =>
        h(
          Text,
          { key: i, style: styles.traceLine },
          `${i + 1}. ${JSON.stringify((c.params as { text: string; enter: boolean }).text)}  enter=${String((c.params as { enter: boolean }).enter)}`
        )
      )
    )
  )
}

const styles = StyleSheet.create({
  page: {
    minHeight: '100%',
    backgroundColor: '#0a0a0a',
    padding: spacing.lg,
    alignItems: 'center'
  },
  title: { color: colors.textPrimary, fontSize: 16, fontWeight: '600', marginBottom: spacing.md },
  phone: {
    width: 390,
    height: 620,
    backgroundColor: colors.bgBase,
    borderRadius: radii.card,
    borderWidth: 1,
    borderColor: colors.borderSubtle,
    overflow: 'hidden',
    justifyContent: 'flex-end'
  },
  header: {
    color: colors.textSecondary,
    fontSize: 13,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.md,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: colors.borderSubtle
  },
  transcript: { flex: 1 },
  tc: { paddingVertical: spacing.md },
  trace: {
    width: 390,
    marginTop: spacing.md,
    padding: spacing.sm,
    backgroundColor: '#141414',
    borderRadius: radii.button,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.borderSubtle
  },
  traceTitle: { color: colors.textSecondary, fontSize: 12, fontWeight: '600', marginBottom: 4 },
  traceLine: { color: colors.statusGreen, fontFamily: 'monospace', fontSize: 11, lineHeight: 16 }
})

createRoot(document.getElementById('root')!).render(h(App))
