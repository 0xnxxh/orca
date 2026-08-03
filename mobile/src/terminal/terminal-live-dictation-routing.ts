import type { TerminalLiveExternalInputRunner } from './terminal-live-input-sender'

// Routes a finished dictation transcript to the right surface: live mode inserts
// it straight into the originating PTY (matching live keystroke semantics, no
// auto-Return); buffered mode appends to the command field as before.

export type LiveDictationRoute =
  | { readonly kind: 'live-insert'; readonly text: string }
  | { readonly kind: 'buffered-append'; readonly text: string }

export function routeDictationTranscript(
  transcript: string,
  liveInputActive: boolean
): LiveDictationRoute {
  return liveInputActive
    ? { kind: 'live-insert', text: transcript }
    : { kind: 'buffered-append', text: transcript }
}

// Mirrors the prior buffered onTranscript behavior: append after existing text
// with a single separating space, or replace an empty/whitespace-only field.
export function appendBufferedDictation(current: string, transcript: string): string {
  if (!current.trim()) {
    return transcript
  }
  return `${current.trimEnd()} ${transcript}`
}

type InsertLiveDictationTranscriptOptions = {
  readonly handle: string
  readonly onSendError: () => void
  readonly runTerminalLiveExternalInput: TerminalLiveExternalInputRunner
  readonly sendInput: (handle: string, text: string) => Promise<boolean>
  readonly showToast: (message: string, durationMs?: number) => void
  readonly text: string
}

export async function insertLiveDictationTranscript({
  handle,
  onSendError,
  runTerminalLiveExternalInput,
  sendInput,
  showToast,
  text
}: InsertLiveDictationTranscriptOptions): Promise<boolean> {
  let sendAttempted = false
  const inserted = await runTerminalLiveExternalInput(handle, async () => {
    sendAttempted = true
    return sendInput(handle, text)
  })
  if (inserted) {
    showToast('Dictation inserted')
    return true
  }
  if (sendAttempted) {
    onSendError()
  }
  showToast('Dictation insert canceled', 1500)
  return false
}
