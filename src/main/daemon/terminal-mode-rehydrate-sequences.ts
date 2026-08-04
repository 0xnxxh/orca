import { buildMouseModeRearmSequence } from '../../shared/terminal-mouse-mode-sequences'
import type { TerminalModes } from './types'

// Why no kitty flags here: rehydrateSequences feeds renderer xterms, and
// POST_REPLAY_REATTACH_RESET's deliberate kitty reset (stale CSI-u Ctrl+C
// hazard) must stay authoritative. modes.kittyKeyboardFlags exists for
// emulator re-seed parity only; a re-seeded emulator answers ?0u and
// protocol-conformant programs re-push.
export function buildRehydrateSequences(modes: TerminalModes): string {
  const seqs: string[] = []
  if (modes.alternateScreen) {
    // Why: normal-buffer serialization can leave its pen active, while the
    // separately serialized alt body assumes it starts from default SGR.
    seqs.push('\x1b[0m\x1b[?1049h')
  }
  if (modes.bracketedPaste) {
    seqs.push('\x1b[?2004h')
  }
  if (modes.applicationCursor) {
    seqs.push('\x1b[?1h')
  }
  // Why: mobile alt-screen scroll gestures need xterm's mouse mode restored
  // from cold snapshots; OpenCode/OpenTUI enables scrollable panes this way.
  // Why shared: the renderer re-arms the same bytes after a reattach reset.
  seqs.push(
    buildMouseModeRearmSequence({
      mouseTrackingMode: modes.mouseTracking ? (modes.mouseTrackingMode ?? 'vt200') : 'none',
      sgrMouseMode: modes.sgrMouseMode === true,
      sgrMousePixelsMode: modes.sgrMousePixelsMode === true
    })
  )
  return seqs.join('')
}
