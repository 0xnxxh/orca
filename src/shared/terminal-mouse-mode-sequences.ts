export type TerminalMouseTrackingMode = 'none' | 'x10' | 'vt200' | 'drag' | 'any'

export type TerminalMouseModeState = {
  mouseTrackingMode: TerminalMouseTrackingMode
  sgrMouseMode: boolean
  sgrMousePixelsMode: boolean
}

/** True when the replay's final screen mode is an alternate-screen buffer. */
export function replayPayloadEndsInAlternateScreen(payload: string): boolean {
  let alternateScreen = false
  // oxlint-disable-next-line no-control-regex -- terminal escape sequences require control chars
  const alternateScreenRe = /\x1bc|\x1b\[\?([0-9;]+)([hl])|\x9b\?([0-9;]+)([hl])/g
  let match: RegExpExecArray | null
  while ((match = alternateScreenRe.exec(payload)) !== null) {
    if (match[0] === '\x1bc') {
      alternateScreen = false
      continue
    }
    const params = match[1] ?? match[3]
    const enabled = (match[2] ?? match[4]) === 'h'
    if (params.split(';').some((param) => param === '47' || param === '1047' || param === '1049')) {
      alternateScreen = enabled
    }
  }
  return alternateScreen
}

// Why: PTY/SSH chunks can split a long combined DECSET before the final h/l.
// Keep parser state far beyond normal mode lists while still bounding memory.
const PRIVATE_MODE_SCAN_TAIL_LIMIT = 4096

/**
 * Mirrors DECSET mouse-protocol/encoding state from the raw byte stream.
 * xterm's public modes API does not expose which mouse protocol is active,
 * so snapshots track it independently of the headless terminal; callers
 * must feed `scan()` the same bytes the terminal parsed, in order.
 *
 * Lives in shared so the daemon (authoritative mirror) and the renderer
 * (reattach re-arm) can never disagree about what a payload left armed.
 */
export class TerminalMouseModeMirror {
  private scanTail = ''
  private trackingModeState: TerminalMouseTrackingMode = 'none'
  private sgrMouseModeState = false
  private sgrMousePixelsModeState = false

  get mouseTrackingMode(): TerminalMouseTrackingMode {
    return this.trackingModeState
  }

  get sgrMouseMode(): boolean {
    return this.sgrMouseModeState
  }

  get sgrMousePixelsMode(): boolean {
    return this.sgrMousePixelsModeState
  }

  scan(data: string): void {
    // Why the pre-filter: this runs on the daemon's per-chunk hot path for
    // every session; a flood chunk with no private-mode/reset introducer
    // must not pay the regex pass (measured share of a 2.2x ingest
    // regression — findings log 2026-07-03). Split sequences stay correct:
    // an introducer split across chunks either left a non-empty scanTail
    // (previous partial) or ends this chunk, which extractScanTail retains.
    if (
      this.scanTail.length === 0 &&
      !data.includes('\x1b[?') &&
      !data.includes('\x1bc') &&
      !data.includes('\x9b')
    ) {
      this.scanTail = this.extractScanTail(data)
      return
    }
    const input = this.scanTail.length === 0 ? data : this.scanTail + data
    this.scanTail = this.extractScanTail(input)
    // oxlint-disable-next-line no-control-regex -- terminal escape sequences require control chars
    const privateModeRe = /\x1bc|\x1b\[\?([0-9;]+)([hl])|\x9b\?([0-9;]+)([hl])/g
    let match: RegExpExecArray | null
    while ((match = privateModeRe.exec(input)) !== null) {
      if (match[0] === '\x1bc') {
        this.trackingModeState = 'none'
        this.sgrMouseModeState = false
        this.sgrMousePixelsModeState = false
        continue
      }
      const params = match[1] ?? match[3]
      const enabled = (match[2] ?? match[4]) === 'h'
      for (const rawParam of params.split(';')) {
        if (rawParam === '') {
          continue
        }
        const param = Number(rawParam)
        if (!Number.isInteger(param)) {
          continue
        }
        if (param === 9) {
          this.trackingModeState = enabled ? 'x10' : 'none'
        }
        if (param === 1000) {
          this.trackingModeState = enabled ? 'vt200' : 'none'
        }
        if (param === 1002) {
          this.trackingModeState = enabled ? 'drag' : 'none'
        }
        if (param === 1003) {
          this.trackingModeState = enabled ? 'any' : 'none'
        }
        if (param === 1006) {
          this.sgrMouseModeState = enabled
          this.sgrMousePixelsModeState = false
        }
        if (param === 1016) {
          this.sgrMouseModeState = false
          this.sgrMousePixelsModeState = enabled
        }
      }
    }
  }

  private extractScanTail(input: string): string {
    const start = Math.max(input.lastIndexOf('\x1b'), input.lastIndexOf('\x9b'))
    if (start === -1) {
      return ''
    }
    const tail = input.slice(start)
    if (tail.length > PRIVATE_MODE_SCAN_TAIL_LIMIT) {
      return ''
    }
    if (tail === '\x1b' || tail === '\x1b[' || tail === '\x9b') {
      return tail
    }
    if (tail.startsWith('\x1b[?')) {
      return this.isIncompleteParams(tail.slice(3)) ? tail : ''
    }
    if (tail.startsWith('\x9b?')) {
      return this.isIncompleteParams(tail.slice(2)) ? tail : ''
    }
    return ''
  }

  private isIncompleteParams(params: string): boolean {
    return /^[0-9;]*$/.test(params)
  }
}

/**
 * DECSET bytes that re-arm the given mouse protocol + encoding.
 * Why the encoding is independent: xterm tracks protocol and SGR encoding as
 * separate modes, so the encoding must be preserved even when reporting is off.
 */
export function buildMouseModeRearmSequence(state: TerminalMouseModeState): string {
  const seqs: string[] = []
  switch (state.mouseTrackingMode) {
    case 'x10':
      seqs.push('\x1b[?9h')
      break
    case 'vt200':
      seqs.push('\x1b[?1000h')
      break
    case 'drag':
      seqs.push('\x1b[?1002h')
      break
    case 'any':
      seqs.push('\x1b[?1003h')
      break
    case 'none':
      break
  }
  if (state.sgrMousePixelsMode) {
    seqs.push('\x1b[?1016h')
  } else if (state.sgrMouseMode) {
    seqs.push('\x1b[?1006h')
  }
  return seqs.join('')
}

/** Mouse modes a replayed payload leaves armed, as DECSET bytes ('' when none). */
export function scanReplayedMouseModeRearm(
  payload: string,
  options: { isAlternateScreen?: boolean } = {}
): string {
  // Why: a dead TUI can leave mouse modes in a normal-buffer snapshot. Only
  // re-arm a replay that still represents a live full-screen TUI.
  if (!(options.isAlternateScreen ?? replayPayloadEndsInAlternateScreen(payload))) {
    return ''
  }
  const mirror = new TerminalMouseModeMirror()
  mirror.scan(payload)
  return buildMouseModeRearmSequence({
    mouseTrackingMode: mirror.mouseTrackingMode,
    sgrMouseMode: mirror.sgrMouseMode,
    sgrMousePixelsMode: mirror.sgrMousePixelsMode
  })
}
