// Why this module is shared: these profiles describe a terminal-protocol
// contract, not a renderer concern. Both the renderer (replaying a snapshot
// into an xterm) and the daemon (seeding a cold-restored session) must clear
// the same mode bits, and duplicating the literals drifted them apart (#12101).

// Why: SerializeAddon replays mode bits assuming reattach to a live TUI, but Orca restores against a fresh shell with none, so stale bits (e.g. focus reporting rings the bell on click) must be reset.
export const RESET_TERMINAL_CURSOR_STYLE = '\x1b[0 q'
export const RESET_KITTY_KEYBOARD_PROTOCOL = '\x1b[<99u\x1b[=0u'
// Every mouse mode the daemon can re-arm from a snapshot: protocols 9/1000/1002/1003 + SGR encodings 1006/1016.
export const RESET_MOUSE_REPORTING =
  '\x1b[?9l\x1b[?1000l\x1b[?1002l\x1b[?1003l\x1b[?1006l\x1b[?1016l'

export const POST_REPLAY_MODE_RESET = `${RESET_TERMINAL_CURSOR_STYLE}${RESET_KITTY_KEYBOARD_PROTOCOL}\x1b[?25h${RESET_MOUSE_REPORTING}\x1b[?1004l\x1b[?2004l`

// Why: same-session live replay; keep cursor/focus cleanup but preserve Kitty flags the running TUI relies on.
export const POST_REPLAY_LIVE_SNAPSHOT_RESET = `${RESET_TERMINAL_CURSOR_STYLE}\x1b[?25h\x1b[?1004l`

// Why: daemon reattach hits a live session, so skip the full reset; still clear cursor/focus/mouse/Kitty bits harmful to a plain shell after a bad TUI exit — safe for live TUIs since the post-reattach SIGWINCH repaints the cursor.
export const POST_REPLAY_REATTACH_RESET = `${RESET_TERMINAL_CURSOR_STYLE}${RESET_KITTY_KEYBOARD_PROTOCOL}\x1b[?25h${RESET_MOUSE_REPORTING}\x1b[?1004l`

// Why: a live agent owns focus reporting; resetting ?1004h suppresses the focus-in it needs to re-anchor its cursor (IME).
export const POST_REPLAY_LIVE_AGENT_REATTACH_RESET = `${RESET_TERMINAL_CURSOR_STYLE}${RESET_KITTY_KEYBOARD_PROTOCOL}\x1b[?25h`

// Why: a live agent owns cursor/focus here; forcing ?25h/?1004l breaks a parked agent that only arms ?1004h at startup.
export const POST_REPLAY_LIVE_AGENT_SNAPSHOT_RESET = RESET_TERMINAL_CURSOR_STYLE

/**
 * Cold-restore seed. Precondition, established by the caller and not checkable
 * here: the session ended without a clean `endedAt` (or failed an aliveness probe)
 * and a fresh process has replaced it, so the recovered bytes re-arm modes for a
 * TUI that no longer exists and the replacement shell inherits them (#12101).
 *
 * Why mouse-only rather than POST_REPLAY_MODE_RESET: this rides *inside* the
 * seed, which also feeds the daemon's own emulator and is re-serialized from
 * there. Cursor style and Kitty flags are re-asserted downstream by the
 * renderer's own post-replay profile, and `?1049h` in the seed must survive so a
 * hibernated TUI's last frame is not blanked. Bracketed paste (`?2004h`) and
 * application cursor (`?1h`) re-arm the same way and are deliberately not
 * covered here — same class, unpinned by #12101, and widening needs its own repro.
 */
export const COLD_RESTORE_SEED_MODE_RESET = RESET_MOUSE_REPORTING

// Why: DECTCEM applies in emission order, so the payload's last ?25l/?25h is the cursor state the TUI left.
export function replayPayloadEndsWithCursorHidden(payload: string): boolean {
  const hideIndex = payload.lastIndexOf('\x1b[?25l')
  return hideIndex !== -1 && hideIndex > payload.lastIndexOf('\x1b[?25h')
}

// Why: some agents hide the real cursor and draw their own, so preserve the payload's final visibility (pty-connection re-shows it if the agent was actually a dead TUI).
export function buildPostReplayLiveAgentReattachReset(payload: string): string {
  return replayPayloadEndsWithCursorHidden(payload)
    ? `${RESET_TERMINAL_CURSOR_STYLE}${RESET_KITTY_KEYBOARD_PROTOCOL}`
    : POST_REPLAY_LIVE_AGENT_REATTACH_RESET
}
