import { execFileSync } from 'node:child_process'
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

const ABC_ID = 'com.apple.keylayout.ABC'
const SIMPLE_TELEX_ID = 'com.apple.inputmethod.VietnameseSimpleTelex'
const RECORDED_VIETNAMESE_COMMIT_BOUNDARIES = [
  { type: 'compositionend', data: 'tiếng ', value: 'tiếng ' },
  { type: 'compositionend', data: 'việt', value: 'tiếng việt' }
] as const

function typeKeyCodes(processId: number, keyCodes: readonly number[]): void {
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
    'delay 0.1',
    '-e',
    'end repeat',
    '-e',
    'end tell'
  ])
}

function selectInputSource(inputSourceId: string): void {
  execFileSync('swift', ['.tmp/select-input-source.swift', inputSourceId])
}

test.describe('Native macOS Vietnamese terminal input @headful', () => {
  test.skip(
    process.platform !== 'darwin' || process.env.ORCA_E2E_NATIVE_MACOS_VIETNAMESE !== '1',
    'Requires macOS with Simple Telex selected and Accessibility access'
  )

  test('commits Telex text once without normalizing it', async ({
    electronApp,
    orcaPage,
    testRepoPath
  }, testInfo) => {
    await waitForSessionReady(orcaPage)
    await waitForActiveWorktree(orcaPage)
    await ensureTerminalVisible(orcaPage)
    await waitForActiveTerminalManager(orcaPage, 30_000)
    await expect(orcaPage.evaluate(() => window.api.app.getKeyboardInputSourceId())).resolves.toBe(
      SIMPLE_TELEX_ID
    )

    const ptyId = await waitForActivePanePtyId(orcaPage)
    let reader = createTerminalImeByteReader(testRepoPath, 1)
    let completed = false
    try {
      await startTerminalImeByteReader(orcaPage, ptyId, reader)
      await focusActiveTerminalInput(orcaPage)
      await installTerminalImeBoundaryProbe(orcaPage)
      typeKeyCodes(
        electronApp.process().pid!,
        [17, 34, 14, 14, 1, 45, 5, 49, 9, 34, 14, 14, 17, 38, 36]
      )

      expect(await waitForTerminalImeBytes(orcaPage, reader)).toEqual([
        Buffer.from('tiếng việt\n').toString('hex')
      ])
      const commitTrace = await readTerminalImeBoundaryTrace(orcaPage)
      expect(commitTrace.dom.filter((event) => event.type === 'compositionend')).toMatchObject(
        RECORDED_VIETNAMESE_COMMIT_BOUNDARIES
      )
      expect(commitTrace.onData.join('')).toBe('tiếng việt\r')

      removeTerminalImeByteReader(reader)
      reader = createTerminalImeByteReader(testRepoPath, 1)
      await startTerminalImeByteReader(orcaPage, ptyId, reader)
      selectInputSource(ABC_ID)
      await expect
        .poll(() => orcaPage.evaluate(() => window.api.app.getKeyboardInputSourceId()))
        .toBe(ABC_ID)
      await orcaPage.keyboard.type('ordinary')
      await orcaPage.keyboard.press('Enter')
      expect(await waitForTerminalImeBytes(orcaPage, reader)).toEqual([
        Buffer.from('ordinary\n').toString('hex')
      ])
      expect((await readTerminalImeBoundaryTrace(orcaPage)).onData.join('')).toBe(
        'tiếng việt\rordinary\r'
      )
      completed = true
    } finally {
      await attachTerminalImeBoundaryEvidence(orcaPage, testInfo, 'native-macos-vietnamese').catch(
        () => undefined
      )
      await disposeTerminalImeBoundaryProbe(orcaPage).catch(() => undefined)
      if (!completed) {
        await sendToTerminal(orcaPage, ptyId, '\x03').catch(() => undefined)
      }
      removeTerminalImeByteReader(reader)
      selectInputSource(ABC_ID)
    }
  })
})
