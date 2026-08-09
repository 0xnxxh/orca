/**
 * Native macOS hardware coverage for a third-party input source outside every allowlist.
 *
 * This is the arm no headless spec can express. Qingg (`com.aodaren.inputmethod.Qingg`) matches none
 * of the terms the pre-structural build enumerated — verified by running those term lists against
 * the id, not assumed — so on that build the bypass never installs and the character is destroyed
 * before the input source can commit it.
 *
 * **The mechanism, stated precisely, because the obvious wording is wrong.** The old build does not
 * "discard the substituted character". Pressing `.` there produces `keydown` and `keyup` and
 * *nothing else* — no `keypress`, no `beforeinput`, no `input`. xterm manufactures the ASCII byte
 * from the keydown and `preventDefault()` tears down the text pipeline before the input source is
 * ever asked. Under the structural rule the same key yields `keypress` with `keyCode 12290` (0x3002)
 * and `beforeinput` carrying `。`.
 *
 * **The verdict is mode-independent.** What the input source committed at the DOM boundary must
 * equal what the PTY received. Nothing here assumes Qingg is in full-width punctuation mode; if it
 * is in English-punctuation mode it commits `.` and the PTY must receive `.`. That is why the
 * assertion is an equality between two measurements rather than a comparison against a hardcoded
 * glyph — and it is what makes the spec survive an operator whose punctuation mode we cannot see.
 *
 * **Read `beforeinput`, never `input`.** The forwarder registers `input` in the capture phase on the
 * pane element and calls `stopImmediatePropagation()` once it has the bytes, so a probe bound to the
 * descendant helper textarea never observes it — a strict run against a correct build fails for that
 * reason alone, with the right bytes underneath. `beforeinput` fires first, is never consumed,
 * carries the same `data`, and means the same thing on both builds.
 */
import { execFileSync } from 'node:child_process'
import type { Page, TestInfo } from '@stablyai/playwright-test'
import { expect, test } from './helpers/orca-app'
import { ensureTerminalVisible, waitForActiveWorktree, waitForSessionReady } from './helpers/store'
import {
  focusActiveTerminalInput,
  sendToTerminal,
  waitForActivePanePtyId,
  waitForActiveTerminalManager
} from './helpers/terminal'
import {
  attachTerminalImeBoundaryEvidence,
  disposeTerminalImeBoundaryProbe,
  installTerminalImeBoundaryProbe,
  readTerminalImeBoundaryTrace
} from './terminal-ime-boundary-probe'
import {
  createTerminalImeByteReader,
  removeTerminalImeByteReader,
  startTerminalImeByteReader,
  waitForTerminalImeBytes
} from './terminal-ime-byte-reader'
import { samplePreeditOverlay } from './terminal-ime-preedit-overlay-probe'

const QINGG_INPUT_SOURCE_ID =
  process.env.ORCA_E2E_QINGG_INPUT_SOURCE_ID ?? 'com.aodaren.inputmethod.Qingg'
const ASCII_INPUT_SOURCE_ID =
  process.env.ORCA_E2E_ASCII_INPUT_SOURCE_ID ?? 'com.apple.keylayout.ABC'
/** Optional operator-supplied binary taking one input-source id. Without it the operator selects. */
const SELECT_INPUT_SOURCE = process.env.ORCA_E2E_NATIVE_INPUT_SOURCE_SELECT ?? ''

const KEY_A = 0
const KEY_BACKSLASH = 42
const KEY_COMMA = 43
const KEY_PERIOD = 47
const KEY_RETURN = 36
const KEY_ESCAPE = 53

/** Each probe is one keystroke plus Return, so the byte reader sees exactly one line per probe. */
const PROBES = [
  {
    label: 'backslash',
    keyCode: KEY_BACKSLASH,
    ascii: '\\',
    // The in-session positive control. The pre-structural build kept a narrow `code === 'Backslash'`
    // bypass, so this key is correct there too. That asymmetry is the point: it proves the input
    // source really was driving this session, so the other two arms cannot be waved away as
    // "Qingg was not active". It is asserted, not merely observed — see the skip note below.
    asciiHex: '5c'
  },
  { label: 'period', keyCode: KEY_PERIOD, ascii: '.', asciiHex: '2e' },
  { label: 'comma', keyCode: KEY_COMMA, ascii: ',', asciiHex: '2c' }
] as const

type ProbeVerdict = {
  key: string
  imeCommitted: string
  ptyReceived: string
  ptyHex: string
  domTypes: string[]
}

type BoundaryDomEvent = { type: string; data: string | null; inputType: string | null }

function selectInputSource(id: string): boolean {
  if (!SELECT_INPUT_SOURCE) {
    return false
  }
  execFileSync(SELECT_INPUT_SOURCE, [id])
  execFileSync('/bin/sleep', ['1.5'])
  return true
}

function pressKeyCodes(processId: number, keyCodes: readonly number[], delaySeconds = 0.15): void {
  execFileSync('osascript', [
    '-e',
    `tell application "System Events" to set frontmost of first application process whose unix id is ${processId} to true`,
    '-e',
    'tell application "System Events"',
    '-e',
    `repeat with currentKeyCode in {${keyCodes.join(', ')}}`,
    '-e',
    'key code (currentKeyCode as integer)',
    '-e',
    `delay ${delaySeconds}`,
    '-e',
    'end repeat',
    '-e',
    'end tell'
  ])
}

/**
 * Probes attachment with a **letter**, and never with punctuation.
 *
 * Punctuation substitution emits no `compositionstart` and no `keyCode 229` even under a fully
 * attached input source, so at the keydown it is indistinguishable from having no input source at
 * all. Only a letter opens a composition, so only a letter can answer "did the IME attach". The
 * punctuation arms below are judged on PTY bytes alone for the same reason.
 */
async function imeAttached(page: Page, processId: number): Promise<boolean> {
  for (let attempt = 1; attempt <= 6; attempt += 1) {
    pressKeyCodes(processId, [KEY_A])
    await page.waitForTimeout(700)
    if ((await samplePreeditOverlay(page)).active) {
      pressKeyCodes(processId, [KEY_ESCAPE])
      await page.waitForTimeout(400)
      return true
    }
  }
  return false
}

/** What the input source committed, read at the DOM boundary. See the file header on `beforeinput`. */
function committedGlyphs(dom: readonly BoundaryDomEvent[]): string {
  return dom
    .filter((event) => event.type === 'beforeinput' && event.inputType === 'insertText')
    .map((event) => event.data ?? '')
    .join('')
}

async function measureProbes(
  page: Page,
  testInfo: TestInfo,
  testRepoPath: string,
  processId: number,
  evidenceName: string
): Promise<ProbeVerdict[]> {
  await waitForSessionReady(page)
  await waitForActiveWorktree(page)
  await ensureTerminalVisible(page)
  await waitForActiveTerminalManager(page, 30_000)
  const ptyId = await waitForActivePanePtyId(page)
  const reader = createTerminalImeByteReader(testRepoPath, PROBES.length)
  try {
    await focusActiveTerminalInput(page)
    // Clear anything the attachment probe left on the prompt before the reader starts.
    await sendToTerminal(page, ptyId, '\x15')
    await startTerminalImeByteReader(page, ptyId, reader)
    await focusActiveTerminalInput(page)
    await installTerminalImeBoundaryProbe(page)

    const domMarks: number[] = []
    for (const probe of PROBES) {
      pressKeyCodes(processId, [probe.keyCode, KEY_RETURN])
      await page.waitForTimeout(900)
      domMarks.push((await readTerminalImeBoundaryTrace(page)).dom.length)
    }

    const lines = await waitForTerminalImeBytes(page, reader)
    const trace = await readTerminalImeBoundaryTrace(page)
    const verdicts: ProbeVerdict[] = []
    let start = 0
    PROBES.forEach((probe, index) => {
      const dom = trace.dom.slice(start, domMarks[index]) as BoundaryDomEvent[]
      start = domMarks[index]!
      const ptyHex = lines[index] ?? ''
      verdicts.push({
        key: probe.ascii,
        imeCommitted: committedGlyphs(dom),
        ptyReceived: Buffer.from(ptyHex, 'hex').toString('utf8').replace(/\n$/, ''),
        ptyHex,
        // Pins the mechanism: on the pre-structural build this is exactly ['keydown','keyup'].
        domTypes: dom.map((event) => event.type)
      })
    })
    await testInfo.attach(`${evidenceName}-verdicts.json`, {
      body: JSON.stringify(verdicts, null, 2),
      contentType: 'application/json'
    })
    return verdicts
  } finally {
    await attachTerminalImeBoundaryEvidence(page, testInfo, evidenceName).catch(() => undefined)
    await disposeTerminalImeBoundaryProbe(page).catch(() => undefined)
    await sendToTerminal(page, ptyId, '\x03').catch(() => undefined)
    removeTerminalImeByteReader(reader)
  }
}

test.describe('Native macOS non-allowlist input source punctuation @headful', () => {
  test.describe.configure({ mode: 'serial' })
  test.skip(
    process.platform !== 'darwin' || process.env.ORCA_E2E_NATIVE_MACOS_QINGG !== '1',
    'Requires macOS with Qingg installed and Accessibility access; set ORCA_E2E_NATIVE_MACOS_QINGG=1'
  )

  test('what the input source commits is what the PTY receives', async ({
    electronApp,
    orcaPage,
    testRepoPath
  }, testInfo) => {
    selectInputSource(QINGG_INPUT_SOURCE_ID)
    const processId = electronApp.process().pid!
    await waitForSessionReady(orcaPage)
    await waitForActiveWorktree(orcaPage)
    await ensureTerminalVisible(orcaPage)
    await waitForActiveTerminalManager(orcaPage, 30_000)
    await focusActiveTerminalInput(orcaPage)

    // macOS attaches an input method per app instance, and the attach can simply fail: measured
    // under exclusive host access, 3 of 6 instances never attached, and re-issuing the input-source
    // selection did not recover one of them across 9 keystrokes and 2 re-selections. It is permanent
    // for that instance's life, so a non-attached run is a refusal to measure, never a negative
    // result — skip it rather than failing and rather than gating on a fully green session.
    test.skip(
      !(await imeAttached(orcaPage, processId)),
      'The input method never attached to this app instance (no composition after 6 letter keystrokes). Known macOS per-instance attach failure, not recoverable by retry — rerun the spec for a fresh instance.'
    )

    const verdicts = await measureProbes(
      orcaPage,
      testInfo,
      testRepoPath,
      processId,
      'qingg-punctuation'
    )

    for (const verdict of verdicts) {
      // Non-vacuity, and the sharp end of the mechanism: on the pre-structural build the DOM shows
      // only keydown/keyup, so nothing was committed at all and this fails before the equality does.
      expect(
        verdict.imeCommitted,
        `${verdict.key}: the input source committed nothing — DOM was ${JSON.stringify(verdict.domTypes)}. The keydown produced the byte and preventDefault tore down the text pipeline.`
      ).not.toBe('')
      expect(
        verdict.ptyReceived,
        `${verdict.key}: the input source committed ${JSON.stringify(verdict.imeCommitted)} but the PTY received ${JSON.stringify(verdict.ptyReceived)}`
      ).toBe(verdict.imeCommitted)
    }
  })

  test('a plain ASCII layout substitutes nothing', async ({
    electronApp,
    orcaPage,
    testRepoPath
  }, testInfo) => {
    // Mandatory control. Without it a build that blanket-rewrote every `.` into `。` would pass the
    // Qingg arm above and be badly wrong. Needs a second input source selected, so it can only run
    // unattended when the operator supplies a selector binary.
    test.skip(
      !selectInputSource(ASCII_INPUT_SOURCE_ID),
      'Needs to switch input sources; set ORCA_E2E_NATIVE_INPUT_SOURCE_SELECT to a binary taking one input-source id'
    )

    const verdicts = await measureProbes(
      orcaPage,
      testInfo,
      testRepoPath,
      electronApp.process().pid!,
      'ascii-layout-control'
    )

    PROBES.forEach((probe, index) => {
      const verdict = verdicts[index]!
      expect(
        verdict.ptyHex.replace(/0a$/, ''),
        `${probe.ascii} was substituted with no input source active — the build rewrites punctuation unconditionally`
      ).toBe(probe.asciiHex)
    })
  })
})
