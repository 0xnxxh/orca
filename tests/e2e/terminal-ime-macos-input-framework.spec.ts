/**
 * Headless end-to-end coverage for the macOS terminal IME shape, replayed from native captures.
 *
 * The rest of the macOS coverage in this suite drives Chromium composition through CDP, which is
 * genuine but hand-ordered. These specs replay what the OS actually emitted, and they carry the one
 * property the synthetic sequences cannot assert: on macOS a composing keydown arrives with
 * `keyCode 229` while `key` is still the **single translated character** the input source produced
 * — `ㅎ`, not `Process`. That is exactly the case the ownership rule has to get right, because it
 * is indistinguishable by length from an ordinary printable key, and it is why `key` is read for
 * length and never for identity.
 *
 * Two guarantees are covered:
 *
 *  1. A committed session reaches the PTY intact, including a syllable boundary where one
 *     composition closes and the next opens with no keydown between them.
 *  2. An **abandoned** preedit writes nothing at all. This is the third failure mode, alongside the
 *     macOS downgrade and the Windows/Linux drop: text the user backspaced away leaking to the
 *     shell. Two Chinese input methods are covered because they cancel differently.
 */
import { readFileSync } from 'node:fs'
import path from 'node:path'
import { expect, test } from './helpers/orca-app'
import {
  createTerminalImeByteReader,
  removeTerminalImeByteReader,
  startTerminalImeByteReader,
  waitForTerminalImeBytes
} from './terminal-ime-byte-reader'
import { applyImePlatformPolicy, expectImePlatformPolicy } from './terminal-ime-platform-policy'
import { closeTerminalImePaneArena, openTerminalImePaneArena } from './terminal-ime-pane-arena'
import { samplePreeditOverlay } from './terminal-ime-preedit-overlay-probe'
import {
  replayRecordedImeDomTrace,
  type RecordedImeDomTrace
} from './terminal-ime-recorded-dom-trace-replay'

function loadTrace(fixture: string): RecordedImeDomTrace {
  return JSON.parse(
    readFileSync(path.join(__dirname, 'fixtures', fixture), 'utf8')
  ) as RecordedImeDomTrace
}

const HANGUL_TRACE = loadTrace('macos-2set-hangul-dom-trace.json')

/**
 * Both cancellation captures continue past the closed composition with a literal `ordinary` typed
 * as bare keydowns — the recorder's own negative control. That tail carries no `input` events,
 * because the build it was captured on produced the byte from the keydown itself, so replaying it
 * would measure the recorder rather than the product. Cutting at the `compositionend` keeps every
 * event the cancellation actually consists of and drops only the part that cannot be replayed
 * faithfully.
 */
function upToCompositionEnd(trace: RecordedImeDomTrace): RecordedImeDomTrace {
  const end = trace.dom.findIndex((event) => event.type === 'compositionend')
  return { ...trace, dom: trace.dom.slice(0, end + 1) }
}

const CANCELLED_PREEDIT_CASES = [
  {
    slug: 'pinyin',
    title: 'a pinyin preedit backspaced away writes nothing to the shell',
    trace: upToCompositionEnd(loadTrace('macos-pinyin-cancelled-preedit-dom-trace.json')),
    visibleUpdates: 9
  },
  {
    slug: 'cangjie',
    title: 'a Cangjie preedit backspaced away writes nothing to the shell',
    trace: upToCompositionEnd(loadTrace('macos-cangjie-cancelled-preedit-dom-trace.json')),
    visibleUpdates: 1
  }
] as const

test.describe('Terminal macOS IME input framework', () => {
  test('forwards a recorded 2-Set Korean session as its exact bytes', async ({
    orcaPage,
    testRepoPath
  }, testInfo) => {
    await applyImePlatformPolicy(orcaPage, 'mac')
    await expectImePlatformPolicy(orcaPage, 'mac')
    const arena = await openTerminalImePaneArena(orcaPage)
    const reader = createTerminalImeByteReader(testRepoPath, 1)
    let completed = false
    try {
      await startTerminalImeByteReader(orcaPage, arena.ptyId, reader)

      const replay = await replayRecordedImeDomTrace(orcaPage, HANGUL_TRACE)

      const updates = replay.samples.filter(
        (sample) => sample.type === 'compositionupdate' && sample.data.length > 0
      )
      expect(updates.length, 'the recorded trace carries no composition updates').toBe(8)
      expect(
        updates
          .filter((sample) => sample.overlay.rect.width === 0 || sample.overlay.rect.height === 0)
          .map((sample) => ({ index: sample.index, data: sample.data })),
        'these recorded preedit frames were written into an overlay with no size'
      ).toEqual([])

      expect(replay.onData, 'the replayed byte stream diverged from the native capture').toBe(
        (HANGUL_TRACE.onData ?? []).map((entry) => entry.data).join('')
      )
      expect(replay.onData).toBe('한글\r')

      const received = await waitForTerminalImeBytes(orcaPage, reader)
      expect(received).toEqual([Buffer.from('한글\n').toString('hex')])
      completed = true
    } finally {
      await closeTerminalImePaneArena(arena, testInfo, 'macos-2set-hangul', !completed)
      removeTerminalImeByteReader(reader)
    }
  })

  for (const testCase of CANCELLED_PREEDIT_CASES) {
    test(testCase.title, async ({ orcaPage }, testInfo) => {
      await applyImePlatformPolicy(orcaPage, 'mac')
      const arena = await openTerminalImePaneArena(orcaPage)
      let completed = false
      try {
        const replay = await replayRecordedImeDomTrace(orcaPage, testCase.trace)

        const updates = replay.samples.filter(
          (sample) => sample.type === 'compositionupdate' && sample.data.length > 0
        )
        expect(updates.length, 'the recorded trace carries no composition updates').toBe(
          testCase.visibleUpdates
        )
        expect(
          updates
            .filter((sample) => sample.overlay.rect.width === 0 || sample.overlay.rect.height === 0)
            .map((sample) => ({ index: sample.index, data: sample.data })),
          'these recorded preedit frames were written into an overlay with no size'
        ).toEqual([])

        // The whole point. Not "the right bytes" — no bytes.
        expect(
          replay.onData,
          'text the user backspaced out of the preedit still reached the shell'
        ).toBe('')

        const overlay = await samplePreeditOverlay(orcaPage)
        expect(overlay.active, 'the cancelled preedit is still on screen').toBe(false)
        expect(overlay.rect.width, 'the cancelled preedit still occupies width').toBe(0)
        completed = true
      } finally {
        await closeTerminalImePaneArena(
          arena,
          testInfo,
          `macos-cancelled-preedit-${testCase.slug}`,
          !completed
        )
      }
    })
  }
})
