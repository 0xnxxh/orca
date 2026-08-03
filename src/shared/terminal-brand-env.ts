export const ORCA_TERM_PROGRAM = 'Orca'

// Grok's VS Code profile matches Orca's xterm.js renderer and skips Kitty keyboard negotiation.
export const ORCA_XTERM_TERM_PROGRAM = 'vscode'

export const ORCA_TERMINAL_BRAND_ENV_KEYS = [
  'TERM_PROGRAM',
  'TERM_PROGRAM_VERSION',
  'ORCA_TERM_PROGRAM'
] as const
