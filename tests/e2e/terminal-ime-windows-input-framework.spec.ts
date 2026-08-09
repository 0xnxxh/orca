/**
 * Headless end-to-end coverage for the Windows terminal IME shape, replayed from native captures.
 *
 * Windows is the third ownership path and the only one where a standalone `keyCode 229` keydown is
 * withheld from xterm entirely — macOS and Linux both pass it through so the composition helper can
 * schedule its textarea diff. That split lives behind a `navigator.userAgent` check, so until now
 * the Windows-recorded traces in this suite were replayed under whichever policy the runner
 * happened to report: macOS locally, Linux on the CI shards. Neither is Windows. These specs pin
 * the policy explicitly.
 *
 * The failure mode being guarded is a **dropped** character, not a downgraded one. The Windows
 * framework claims the keystroke as `key: 'Process'` / `keyCode: 229` and produces the text only
 * through the composition session, so anything that swallows the claimed keydown without letting
 * the commit through loses the syllable outright, with nothing on screen to show for it.
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

const NATIVE_TRACE = JSON.parse(
  readFileSync(
    path.join(__dirname, 'fixtures', 'windows-native-2set-hangul-dom-trace.json'),
    'utf8'
  )
) as RecordedImeDomTrace

test.describe('Terminal Windows IME input framework', () => {
  test('commits each Hangul syllable ahead of its newline through the Windows 229 path', async ({
    orcaPage,
    testRepoPath
  }, testInfo) => {
    await applyImePlatformPolicy(orcaPage, 'windows')
    await expectImePlatformPolicy(orcaPage, 'windows')
    const arena = await openTerminalImePaneArena(orcaPage)
    const reader = createTerminalImeByteReader(testRepoPath, 3)
    let completed = false
    try {
      await startTerminalImeByteReader(orcaPage, arena.ptyId, reader)

      const replay = await replayRecordedImeDomTrace(orcaPage, NATIVE_TRACE)

      const updates = replay.samples.filter(
        (sample) => sample.type === 'compositionupdate' && sample.data.length > 0
      )
      expect(updates.length, 'the recorded trace carries no composition updates').toBe(9)
      expect(
        updates
          .filter((sample) => sample.overlay.rect.width === 0 || sample.overlay.rect.height === 0)
          .map((sample) => ({ index: sample.index, data: sample.data })),
        'these recorded preedit frames were written into an overlay with no size'
      ).toEqual([])

      // Enter reaches the renderer twice per line: first as Process/229, which the framework uses
      // to close the composition, then as the real Enter. If the two ever swap, the newline
      // overtakes the syllable and the shell runs an empty line — the ordering the user reported.
      // The capture ran in a recorder isolated from the app so it carries no byte stream of its
      // own; `가\r` per line is what the recorded keystrokes mean, not a replayed observation.
      expect(replay.onData).toBe('가\r가\r가\r')

      const received = await waitForTerminalImeBytes(orcaPage, reader)
      expect(received).toEqual(Array.from({ length: 3 }, () => Buffer.from('가\n').toString('hex')))
      completed = true
    } finally {
      await closeTerminalImePaneArena(arena, testInfo, 'windows-native-2set-hangul', !completed)
      removeTerminalImeByteReader(reader)
    }
  })

  test('holding Shift across the commit neither drops nor duplicates the syllable', async ({
    orcaPage
  }, testInfo) => {
    // The second and third lines of the capture are committed with Shift physically held, and the
    // framework interleaves `Process`/`Shift` keydowns while it is. Shift stays eligible for text
    // ownership by design — shifted punctuation still commits substituted text — so a rule that
    // treated any modifier as disqualifying would silently lose these two lines while the first
    // kept working, which is the shape of bug that reads as "it only breaks sometimes".
    await applyImePlatformPolicy(orcaPage, 'windows')
    const arena = await openTerminalImePaneArena(orcaPage)
    let completed = false
    try {
      // Cut at a line boundary — the `Process` keydown that opens the second composition — so the
      // replay still starts from a complete keystroke rather than from the middle of one.
      const secondLineStart =
        NATIVE_TRACE.dom.reduce<number[]>(
          (starts, event, index) =>
            event.type === 'compositionstart' ? [...starts, index] : starts,
          []
        )[1] - 1
      const shiftedTail = { ...NATIVE_TRACE, dom: NATIVE_TRACE.dom.slice(secondLineStart) }
      const replay = await replayRecordedImeDomTrace(orcaPage, shiftedTail)
      expect(replay.onData).toBe('가\r가\r')
      completed = true
    } finally {
      await closeTerminalImePaneArena(arena, testInfo, 'windows-shift-held-commit', !completed)
    }
  })
})
