import { describe, expect, it } from 'vitest'
import {
  createShellStartupOutputScanState,
  drainShellStartupOutputScanState,
  scanShellStartupOutput
} from './shell-startup-output-scanner'

const READY_MARKER = '\x1b]777;orca-shell-ready\x07'

describe('shell startup output scanner', () => {
  it.each([
    ['after the ready marker', [READY_MARKER, '\x1b[?2004hfish> ']],
    ['after the ESC introducer', [`${READY_MARKER}\x1b`, '[?2004hfish> ']]
  ])('preserves Fish output split %s', (_boundary, chunks) => {
    const state = createShellStartupOutputScanState()
    let output = ''

    for (const chunk of chunks) {
      output += scanShellStartupOutput(state, chunk).output
    }

    expect(output).toBe('\x1b[?2004hfish> ')
  })

  it('strips identity and readiness markers from one chunk', () => {
    const state = createShellStartupOutputScanState()
    const scanned = scanShellStartupOutput(
      state,
      `\x1b]777;orca-shell-start:12345\x07${READY_MARKER}prompt`
    )

    expect(scanned).toEqual({
      output: 'prompt',
      shellPid: 12345,
      ready: true,
      postMarkerBytesObserved: true
    })
  })

  it('drains every incomplete scanner prefix in byte order', () => {
    const state = createShellStartupOutputScanState()
    expect(scanShellStartupOutput(state, '\x1b]777;orca-shell-st').output).toBe('')

    expect(drainShellStartupOutputScanState(state)).toBe('\x1b]777;orca-shell-st')
  })
})
