import { LEGACY_TERMINAL_SCROLLBACK_BYTES_100_MB } from '../../shared/terminal-scrollback-policy'

export const TERMINAL_HISTORY_META_MAX_BYTES = 64 * 1024
export const TERMINAL_HISTORY_LOG_MAX_BYTES = 5 * 1024 * 1024
// Why 2x the policy's 100MB budget for the 50k-row max preset: the checkpoint writer is
// unbounded, and a read cap under what it can emit silently drops ALL scrollback on cold
// restore. Guards corruption, not retention; 2x covers JSON escaping, where each ANSI ESC
// serializes to a 6-byte unicode escape.
export const TERMINAL_HISTORY_CHECKPOINT_MAX_BYTES = 2 * LEGACY_TERMINAL_SCROLLBACK_BYTES_100_MB
export const TERMINAL_HISTORY_LEGACY_SCROLLBACK_MAX_BYTES = 16 * 1024 * 1024
