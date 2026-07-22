import { useEffect, useMemo } from 'react'
import { useAppStore } from '../../store'
import type { NativeChatLaunchDraft } from '@/lib/native-chat-launch-prompt'
import type { NativeChatMessage } from '../../../../shared/native-chat-types'
import { launchDraftResolvedByTranscript } from './native-chat-pending'

/** Select the pane's launch draft and whether the transcript has resolved it. */
export function useNativeChatLaunchDraftSignal(args: {
  terminalTabId: string
  agent: string
  messages: NativeChatMessage[]
}): { launchDraft: NativeChatLaunchDraft | null; launchDraftResolved: boolean } {
  const launchDraft = useAppStore((s) => s.nativeChatLaunchDraftByTabId[args.terminalTabId] ?? null)
  const paneLaunchDraft = launchDraft?.agent === args.agent ? launchDraft : null
  const messages = args.messages
  const launchDraftResolved = useMemo(
    () => (paneLaunchDraft ? launchDraftResolvedByTranscript(paneLaunchDraft, messages) : false),
    [paneLaunchDraft, messages]
  )
  return { launchDraft: paneLaunchDraft, launchDraftResolved }
}

/**
 * Adopt launch-time draft context (e.g. a linked issue URL prefilled into the
 * TUI input buffer) into the chat composer, and drop it again once the
 * transcript shows the TUI-side copy was resolved (submitted or cleared).
 *
 * State machine per seeded draft:
 * - unadopted + composer empty  → copy text into the composer, mark adopted
 * - unadopted + composer in use → mark adopted without copying (never stomp)
 * - resolved by transcript      → clear the seed; also clear the composer copy
 *                                 only when it is still the untouched seed text
 */
export function useNativeChatLaunchDraftAdoption(args: {
  terminalTabId: string
  agent: string
  launchDraft: NativeChatLaunchDraft | null | undefined
  launchDraftResolved: boolean
  draft: string
  setDraft: (next: string) => void
  setCaret: (next: number) => void
}): void {
  const { terminalTabId, agent, launchDraft, launchDraftResolved, draft, setDraft, setCaret } = args
  useEffect(() => {
    if (!launchDraft || launchDraft.agent !== agent) {
      return
    }
    if (launchDraftResolved) {
      if (launchDraft.adopted && draft === launchDraft.text) {
        setDraft('')
        setCaret(0)
      }
      useAppStore.getState().clearNativeChatLaunchDraft(terminalTabId)
      return
    }
    if (launchDraft.adopted) {
      return
    }
    // Mark adopted before copying so a composer that already holds user text
    // declines the seed permanently instead of resurrecting it on a later clear.
    useAppStore.getState().markNativeChatLaunchDraftAdopted(terminalTabId)
    if (draft === '') {
      setDraft(launchDraft.text)
      setCaret(launchDraft.text.length)
    }
  }, [agent, draft, launchDraft, launchDraftResolved, setCaret, setDraft, terminalTabId])
}
