/**
 * Headless end-to-end coverage for the Linux terminal IME shapes, replayed from native captures.
 *
 * The Linux failure mode is not the macOS one. macOS downgrades a substituted glyph to its ASCII
 * layout character; Linux input frameworks claim the keystroke outright, so what breaks there is a
 * character that never arrives at all. Three recorded orderings make that concrete, and none of
 * them is something a hand-authored sequence would have produced:
 *
 *  - **IBus/X11** ends its composition with an EMPTY `compositionend`, then delivers the syllable
 *    as a separate non-composing `input` with `inputType: 'insertText'`. Reading the commit off
 *    `compositionend.data` — the obvious implementation, and the one the recorded Windows capture
 *    rewards — drops every syllable on this framework.
 *  - **fcitx5/Wayland** emits no keydown at all for a composing key, not even `keyCode 229`, and
 *    labels the literal `a`/`b`/`c` keydowns with physically wrong `code` values. Any ownership
 *    rule reading 229 or `code` is wrong here; 229 is a positive marker only.
 *  - **Numeric pinyin candidates** (both frameworks) must not reach the shell, while an ordinary
 *    digit typed outside a composition must reach it exactly once. Those pull in opposite
 *    directions, so the negative control is load-bearing rather than decorative.
 *
 * Each trace replays against a terminal pinned to the Linux ownership policy, and is asserted on
 * both sides of the boundary: the preedit's real geometry at every frame the user would see, and
 * the exact bytes the recorded native run put on the PTY.
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
import {
  replayRecordedImeDomTrace,
  type RecordedImeDomTrace
} from './terminal-ime-recorded-dom-trace-replay'

function loadTrace(fixture: string): RecordedImeDomTrace {
  return JSON.parse(
    readFileSync(path.join(__dirname, 'fixtures', fixture), 'utf8')
  ) as RecordedImeDomTrace
}

type LinuxTraceCase = {
  slug: string
  title: string
  trace: RecordedImeDomTrace
  /** Composition frames the user would see. Pinned so a truncated fixture cannot pass vacuously. */
  visibleUpdates: number
  /** Frames whose commit rides on `compositionend.data`; zero is the IBus shape, not an error. */
  commitsCarriedByCompositionEnd: number
}

const LINUX_TRACE_CASES: readonly LinuxTraceCase[] = [
  {
    slug: 'ibus-x11-hangul',
    title: 'IBus on X11 commits Hangul through a post-compositionend insertText',
    trace: loadTrace('linux-ibus-x11-hangul-mixed-ascii-dom-trace.json'),
    visibleUpdates: 30,
    commitsCarriedByCompositionEnd: 0
  },
  {
    slug: 'fcitx5-wayland-hangul',
    title: 'fcitx5 on Wayland commits Hangul with no keydown and no 229 marker',
    trace: loadTrace('linux-fcitx5-wayland-hangul-mixed-ascii-dom-trace.json'),
    visibleUpdates: 40,
    commitsCarriedByCompositionEnd: 10
  },
  {
    slug: 'fcitx5-x11-pinyin',
    title: 'fcitx5 on X11 keeps a numeric pinyin candidate and an ordinary digit apart',
    trace: loadTrace('linux-fcitx5-x11-pinyin-candidate-digit-dom-trace.json'),
    visibleUpdates: 30,
    commitsCarriedByCompositionEnd: 5
  },
  {
    slug: 'ibus-x11-pinyin',
    title: 'IBus on X11 keeps a numeric pinyin candidate and an ordinary digit apart',
    trace: loadTrace('linux-ibus-x11-pinyin-candidate-digit-dom-trace.json'),
    visibleUpdates: 25,
    commitsCarriedByCompositionEnd: 5
  }
]

function recordedOnData(trace: RecordedImeDomTrace): string {
  return (trace.onData ?? []).map((entry) => entry.data).join('')
}

test.describe('Terminal Linux IME input frameworks', () => {
  for (const testCase of LINUX_TRACE_CASES) {
    test(testCase.title, async ({ orcaPage, testRepoPath }, testInfo) => {
      await applyImePlatformPolicy(orcaPage, 'linux')
      await expectImePlatformPolicy(orcaPage, 'linux')
      const expectedOnData = recordedOnData(testCase.trace)
      const expectedLines = [...expectedOnData].filter((char) => char === '\r').length
      const arena = await openTerminalImePaneArena(orcaPage)
      const reader = createTerminalImeByteReader(testRepoPath, expectedLines)
      let completed = false
      try {
        await startTerminalImeByteReader(orcaPage, arena.ptyId, reader)

        const replay = await replayRecordedImeDomTrace(orcaPage, testCase.trace)

        const updates = replay.samples.filter(
          (sample) => sample.type === 'compositionupdate' && sample.data.length > 0
        )
        expect(updates.length, 'the recorded trace carries no composition updates').toBe(
          testCase.visibleUpdates
        )
        const invisible = updates.filter(
          (sample) => sample.overlay.rect.width === 0 || sample.overlay.rect.height === 0
        )
        expect(
          invisible.map((sample) => ({ index: sample.index, data: sample.data })),
          'these recorded preedit frames were written into an overlay with no size'
        ).toEqual([])

        // Pins where each framework hides its commit. The IBus figure is zero, and that zero is
        // the whole reason this file exists.
        const endsCarryingText = replay.samples.filter(
          (sample) => sample.type === 'compositionend' && sample.data.length > 0
        )
        expect(
          endsCarryingText.length,
          'the framework moved its commit onto a different event than the fixture records'
        ).toBe(testCase.commitsCarriedByCompositionEnd)

        expect(replay.onData, 'the replayed byte stream diverged from the native capture').toBe(
          expectedOnData
        )

        const received = await waitForTerminalImeBytes(orcaPage, reader)
        expect(received.join('')).toBe(
          expectedOnData
            .split('\r')
            .filter((line) => line.length > 0)
            .map((line) => Buffer.from(`${line}\n`).toString('hex'))
            .join('')
        )
        completed = true
      } finally {
        await closeTerminalImePaneArena(arena, testInfo, `linux-${testCase.slug}`, !completed)
        removeTerminalImeByteReader(reader)
      }
    })
  }
})
