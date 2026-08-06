// @vitest-environment happy-dom
// HAZARD PIN — owns no reported row. Read this before treating it as a regression guard.
//
// Two ways xterm's composition commit path corrupts the bytes the PTY child reads.
// Both are asserted at onData, not in the DOM: the defect is in the data, not the paint.
//
// 1. A non-exempt keydown during a live composition reaches _finalizeComposition(false)
//    — the IMMEDIATE branch, which computes its range from a live selectionEnd and does
//    not consult _compositionSuffix at all. It commits that range at once, and nothing
//    records what it consumed, so the IME's own compositionend commits an overlapping
//    range and the syllable reaches onData TWICE. macOS Meta (91/93/224) is the
//    production instance: CompositionHelper.keydown exempts only 16/17/18 and 20/229, so
//    Cmd takes this path where Ctrl does not. This is the data consequence of the
//    teardown pinned by terminal-ime-xterm-composition-modifier-exemption.test.ts, which
//    deliberately asserted only the overlay and left the duplicated commit unpinned.
//    Cmd was checked against the swallow in (2) and does NOT reach it: Cmd duplicates,
//    it does not drop. The two hazards below share no trigger.
//
// 2. An uncomposed insertText landing in the window after the commit timer has already
//    sent is swallowed whole. _isSendingComposition stays true for one macrotask after
//    the timer cleared _pendingCompositionStart; handleCompositionInput passes the first
//    check, then reads the cleared sentinel and substitutes '' for the data.
//
//    THIS IS BROADER THAN THE Cmd FRAMING ABOVE. A differential run through Japanese
//    multi-segment conversion found shipped behaviour swallows an ordinary Latin key
//    typed one macrotask after a conversion commit: type a segment, convert, then press
//    `a`, and the `a` is lost. No modifier, no exotic gesture — every Japanese user who
//    keeps typing straight after converting. Korean surfaced it first only because
//    2-Set composes on nearly every keystroke.
//
//    The suppression is NOT a defect on its own: it de-duplicates IMEs that deliver
//    their commit insertText a task after compositionend (IBus, Mozc), which
//    terminal-stock-composition.test.ts pins. This swallow is that dedup's false
//    positive. The two events are structurally identical — same inputType, same
//    composed, same preceding 229 keydown — and differ only in payload, so no
//    flag-timing change separates them. A redesign was built and measured: it fixes
//    this and duplicates on IBus. A content-aware variant fixes both at +5 lines but
//    flips a reported row's test, and is blocked regardless while the patch cannot be
//    regenerated. See .tmp/ime-handoff/swarm-scratch/lane-group-e-redesign/.
//
//    The Japanese arrays in that differential are EXPLICITLY AUTHORED, not observed —
//    no Japanese DOM composition trace exists in this corpus.
//
// Four things a future reader must not misread:
//   1. No reporter has filed either of these. #12164 was considered and rejected: its
//      comment 1 is untyped agent OUTPUT doubling on the wide-glyph repaint path, and
//      its comment 2 is filed against 1.4.163, whose CompositionHelper is a different
//      implementation from HEAD's — measurements here do not transfer to it.
//   2. Measured, not inferred: every expectation below was read off onData against the
//      @xterm/xterm this repo installs (src/browser/input/CompositionHelper.ts,
//      sha256 10893b3e609b3a1d296e03be03e397b5044308d7f7b6a3da6efd06a545c13a21).
//      The comparison bundle is cited, NOT imported — a landed test can only exercise
//      code that ships. Stock 6.1.0-beta.287 CompositionHelper.ts,
//      sha256 1e935e66830ca171456466987cb45ed0a270553901729f11dfa91f6b702e0845
//      (sha1 ebffd1d354428143d712124f92fbcd846e6e44d4, byte-identical across beta.287,
//      .288 and .292, so this is also what VS Code 1.129.1 runs). Against that bundle
//      the duplication is version-NEUTRAL — defective on both, in different magnitudes.
//      The swallowed insertText is NOT: stock delivers the syllable and this bundle
//      drops it, making it the one defect here that is ours rather than inherited.
//   3. Inferred, not measured: that a real macOS IME delivers a compositionend for a
//      composition it kept alive across the Cmd. That is ordinary IME behaviour but no
//      capture contains the gesture, so the trigger is unverified on hardware.
//   4. Unobserved, and the corpus cannot say more than that. Of 731 retained evidence
//      JSONs, 82 carry a keydown-bearing DOM trace; across those, all 3508 keydowns
//      during a live composition are 229 (3443) or Shift/16 (65), and none is
//      non-exempt. A further 59 bundles use a different trace shape that scan did not
//      read — they are SILENT on this branch, not supporting it. And retained captures
//      show the branch was never entered; they cannot show it is unenterable.
//      The same scan refuted an earlier premise that Space reaches this path: Space
//      during composition is keyCode 229 in every capture, and 229 returns early.
//      Do not reintroduce a Space arm.
//
// These assertions pin CURRENT broken behaviour. When someone fixes it they will fail —
// update the expectations to the correct values named in each comment. Do not work
// around them.
import { Terminal } from '@xterm/xterm'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

function nextEventLoop(): Promise<void> {
  return new Promise((resolve) => window.setTimeout(resolve, 0))
}

function openTerminal(): { emitted: string[]; textarea: HTMLTextAreaElement } {
  const container = document.createElement('div')
  document.body.appendChild(container)
  const terminal = new Terminal()
  terminal.open(container)
  const textarea = terminal.textarea
  if (!textarea) {
    throw new Error('xterm helper textarea was not created')
  }
  const emitted: string[] = []
  terminal.onData((data) => emitted.push(data))
  return { emitted, textarea }
}

function dispatchCompositionEvent(
  textarea: HTMLTextAreaElement,
  type: 'compositionstart' | 'compositionupdate' | 'compositionend',
  data = ''
): void {
  const event = new CompositionEvent(type, { bubbles: true })
  // happy-dom ignores CompositionEventInit.data, but Chromium supplies it.
  Object.defineProperty(event, 'data', { value: data })
  textarea.dispatchEvent(event)
}

function dispatchProcessKeydown(textarea: HTMLTextAreaElement): void {
  const keydown = new KeyboardEvent('keydown', { key: 'Process', isComposing: true, bubbles: true })
  Object.defineProperty(keydown, 'keyCode', { value: 229 })
  textarea.dispatchEvent(keydown)
}

function dispatchModifierKeydown(
  textarea: HTMLTextAreaElement,
  modifier: 'Meta' | 'Control'
): void {
  const isMeta = modifier === 'Meta'
  const keydown = new KeyboardEvent('keydown', {
    key: modifier,
    code: isMeta ? 'MetaLeft' : 'ControlLeft',
    metaKey: isMeta,
    ctrlKey: !isMeta,
    bubbles: true
  })
  Object.defineProperty(keydown, 'keyCode', { value: isMeta ? 91 : 17 })
  textarea.dispatchEvent(keydown)
}

function dispatchComposedInput(textarea: HTMLTextAreaElement, init: InputEventInit): void {
  const input = new InputEvent('input', { ...init, bubbles: true })
  Object.defineProperty(input, 'composed', { value: true })
  textarea.dispatchEvent(input)
}

function setValue(textarea: HTMLTextAreaElement, value: string): void {
  textarea.value = value
  textarea.selectionStart = value.length
  textarea.selectionEnd = value.length
}

/** Walk a syllable through its preedits, leaving the composition open. */
async function preeditSyllable(textarea: HTMLTextAreaElement, steps: string[]): Promise<void> {
  for (const step of steps) {
    setValue(textarea, step)
    dispatchCompositionEvent(textarea, 'compositionupdate', step)
    dispatchComposedInput(textarea, { data: step, inputType: 'insertCompositionText' })
    await nextEventLoop()
    dispatchProcessKeydown(textarea)
  }
}

/** Compose 한, interrupted by a modifier after the first jamo. */
async function composeHanInterruptedBy(
  textarea: HTMLTextAreaElement,
  modifier: 'Meta' | 'Control'
): Promise<void> {
  dispatchProcessKeydown(textarea)
  dispatchCompositionEvent(textarea, 'compositionstart')
  await preeditSyllable(textarea, ['ㅎ'])
  dispatchModifierKeydown(textarea, modifier)
  await nextEventLoop()
  await preeditSyllable(textarea, ['하', '한'])
  dispatchCompositionEvent(textarea, 'compositionend', '한')
  await nextEventLoop()
  await nextEventLoop()
}

describe('xterm CompositionHelper — overlapping and swallowed commits at onData', () => {
  beforeEach(() => {
    vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue({
      measureText: () => ({ width: 10 })
    } as unknown as CanvasRenderingContext2D)
  })

  afterEach(() => {
    vi.restoreAllMocks()
    document.body.replaceChildren()
  })

  it('commits the syllable twice when Cmd interrupts the composition', async () => {
    const { emitted, textarea } = openTerminal()
    await composeHanInterruptedBy(textarea, 'Meta')

    // The early commit emits the bare jamo, then compositionend emits the finished
    // syllable over the same range. CORRECT would be ['한'].
    // Pristine beta.287 is worse here, emitting ['ㅎ', '한', '한'].
    expect(emitted).toEqual(['ㅎ', '한'])
  })

  it('commits the syllable twice when Cmd arrives after the last preedit', async () => {
    const { emitted, textarea } = openTerminal()
    dispatchProcessKeydown(textarea)
    dispatchCompositionEvent(textarea, 'compositionstart')
    await preeditSyllable(textarea, ['ㅎ', '하', '한'])
    dispatchModifierKeydown(textarea, 'Meta')
    await nextEventLoop()
    dispatchCompositionEvent(textarea, 'compositionend', '한')
    await nextEventLoop()
    await nextEventLoop()

    // CORRECT would be ['한']. Pristine beta.287 emits the same two commits, which is
    // what makes this arm version-neutral.
    expect(emitted).toEqual(['한', '한'])
  })

  it('leaves the composition intact when Ctrl interrupts in the same position', async () => {
    const { emitted, textarea } = openTerminal()
    await composeHanInterruptedBy(textarea, 'Control')

    // Paired negative: keyCode 17 is exempt, so no early commit and no overlap. The
    // difference between this arm and the first is the exemption set, nothing else.
    expect(emitted).toEqual(['한'])
  })

  it('swallows an uncomposed insertText that lands in the sending window', async () => {
    const { emitted, textarea } = openTerminal()
    dispatchProcessKeydown(textarea)
    dispatchCompositionEvent(textarea, 'compositionstart')
    await preeditSyllable(textarea, ['ㅁ', '무', '문'])
    dispatchCompositionEvent(textarea, 'compositionend', '문')
    // The commit timer has now sent 문 and cleared _pendingCompositionStart, but
    // _isSendingComposition stays true for one more macrotask.
    await nextEventLoop()
    expect(emitted).toEqual(['문'])

    const input = new InputEvent('input', { data: '제', inputType: 'insertText', bubbles: true })
    Object.defineProperty(input, 'composed', { value: false })
    textarea.dispatchEvent(input)
    await nextEventLoop()
    await nextEventLoop()

    // Whole syllable lost. CORRECT would be ['문', '제'], which is what pristine
    // beta.287 emits — this arm, unlike the ones above, is ours.
    expect(emitted).toEqual(['문'])
  })

  it('leaves ordinary Latin typing untouched', async () => {
    const { emitted, textarea } = openTerminal()
    for (const [key, keyCode] of [
      ['a', 65],
      ['b', 66]
    ] as [string, number][]) {
      const keydown = new KeyboardEvent('keydown', {
        key,
        code: `Key${key.toUpperCase()}`,
        bubbles: true
      })
      Object.defineProperty(keydown, 'keyCode', { value: keyCode })
      textarea.dispatchEvent(keydown)
      await nextEventLoop()
    }
    dispatchModifierKeydown(textarea, 'Meta')
    await nextEventLoop()

    // No composition, so no range to overlap and nothing for Cmd to tear down.
    expect(emitted).toEqual(['a', 'b'])
  })
})
