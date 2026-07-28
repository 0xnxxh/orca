import { describe, expect, it } from 'vitest'
import {
  buildTerminalLiveMirrorPayload,
  computeTerminalLiveMirrorStep
} from './terminal-live-hangul-mirror'
import { normalizeTerminalTextInput } from './terminal-text-input-normalization'

// 두벌식 (2-set) composition states for 안녕하세요, as the field shows them
// keystroke by keystroke: ㅇ ㅏ ㄴ ㄴ ㅕ ㅇ ㅎ ㅏ ㅅ ㅔ ㅇ ㅛ.
const DUBEOLSIK_FIELD_STATES = [
  'ㅇ',
  '아',
  '안',
  '안ㄴ',
  '안녀',
  '안녕',
  '안녕ㅎ',
  '안녕하',
  '안녕핫',
  '안녕하세',
  '안녕하셍',
  '안녕하세요'
] as const

const DEL = '\x7f'

// Minimal PTY line model: DEL erases one code point, everything else appends.
function applyToPty(pty: string, payload: string): string {
  let next = Array.from(pty)
  for (const codePoint of Array.from(payload)) {
    if (codePoint === DEL) {
      next = next.slice(0, -1)
      continue
    }
    next.push(codePoint)
  }
  return next.join('')
}

// Replays handleLiveInputChange → applyLiveInputMirror, then the settle-timer
// commit that flushes the last held syllable.
function replayLiveInput(fieldStates: readonly string[]): string {
  let sentText = ''
  let heldText = ''
  let pty = ''

  const step = (fieldText: string, commitHeld: boolean): void => {
    const mirror = computeTerminalLiveMirrorStep(sentText, normalizeTerminalTextInput(fieldText), {
      commitHeld
    })
    pty = applyToPty(pty, buildTerminalLiveMirrorPayload(mirror))
    sentText = mirror.nextSentText
    heldText = mirror.heldText
  }

  for (const fieldText of fieldStates) {
    step(fieldText, false)
  }
  step(sentText + heldText, true)
  return pty
}

describe('iOS decomposed (NFD) Hangul live input', () => {
  it('Given an NFD field (iOS) When the user types 안녕하세요 Then the PTY receives composed syllables, not jamo', () => {
    // Given: Apple text input hands React Native decomposed conjoining jamo, so
    // one syllable arrives as 2-3 code points instead of one.
    const nfdStates = DUBEOLSIK_FIELD_STATES.map((state) => state.normalize('NFD'))
    expect(Array.from(nfdStates.at(-1) ?? '')).toHaveLength(12)

    // When
    const pty = replayLiveInput(nfdStates)

    // Then: the mirror holds only the trailing code point, so without
    // recomposition every leading jamo is committed on its own (#6995 iOS).
    expect(Array.from(pty)).toHaveLength(5)
    expect(pty).toBe('안녕하세요')
  })

  it('Given a precomposed NFC field (Android/Gboard) When the same keys are typed Then the PTY result is unchanged', () => {
    // Given / When
    const pty = replayLiveInput(DUBEOLSIK_FIELD_STATES)

    // Then
    expect(pty).toBe('안녕하세요')
  })

  it('Given NFD Latin diacritics When mirrored Then combining marks reach the PTY already composed', () => {
    // Given / When: iOS also hands back NFD for Vietnamese/European accents.
    const pty = replayLiveInput(['tie', 'tiế', 'tiếng'].map((state) => state.normalize('NFD')))

    // Then
    expect(pty).toBe('tiếng')
    expect(Array.from(pty)).toHaveLength(5)
  })
})
