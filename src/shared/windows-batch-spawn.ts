import { win32 } from 'node:path'

/** Full path to cmd.exe for GUI and service-launched processes. */
export function getCmdExePath(): string {
  return (
    process.env.ComSpec ||
    win32.join(process.env.SystemRoot ?? 'C:\\Windows', 'System32', 'cmd.exe')
  )
}

export function isWindowsBatchScript(commandPath: string): boolean {
  return process.platform === 'win32' && /\.(cmd|bat)$/i.test(commandPath)
}

export const WINDOWS_BATCH_UNSAFE_ARGUMENTS_ERROR = 'UNSAFE_WINDOWS_BATCH_ARGUMENTS'

export class UnsafeWindowsBatchArgumentsError extends Error {
  constructor() {
    super(WINDOWS_BATCH_UNSAFE_ARGUMENTS_ERROR)
    this.name = 'UnsafeWindowsBatchArgumentsError'
  }
}

// Why: cmd.exe re-parses the command line, and these are the characters that can
// start a new command or expand a variable out of an otherwise inert argument.
// `(`/`)` are deliberately absent: they only group commands, and grouping cannot
// chain anything without one of the separators below, so rejecting them merely
// broke every `C:\Program Files (x86)\...` shim and paren-bearing worktree path.
const WINDOWS_BATCH_UNSAFE_CHARACTERS = ['&', '|', '<', '>', '^', '"', '%', '!'] as const

/** The rejected characters, spelled for error messages so they cannot drift from the guard. */
export const WINDOWS_BATCH_UNSAFE_CHARACTERS_LABEL = WINDOWS_BATCH_UNSAFE_CHARACTERS.join(' ')

const UNSAFE_WINDOWS_BATCH_SYNTAX = new RegExp(
  `[${WINDOWS_BATCH_UNSAFE_CHARACTERS.map((character) => character.replace(/[\\^\]-]/, '\\$&')).join('')}\\r\\n]`
)

function hasUnsafeWindowsBatchSyntax(value: string): boolean {
  return UNSAFE_WINDOWS_BATCH_SYNTAX.test(value)
}

export type GetSpawnArgsForWindowsOptions = {
  /**
   * GUI launchers (Open In apps) should not leave a lingering Command Prompt.
   * `start "" /B` returns immediately and keeps console-subsystem children of
   * `.cmd`/`.bat` shims from allocating a fresh visible prompt window.
   */
  detachedGui?: boolean
}

export function getSpawnArgsForWindows(
  command: string,
  args: string[],
  options: GetSpawnArgsForWindowsOptions = {}
): { spawnCmd: string; spawnArgs: string[] } {
  if (isWindowsBatchScript(command)) {
    for (const value of [command, ...args]) {
      if (hasUnsafeWindowsBatchSyntax(value)) {
        throw new UnsafeWindowsBatchArgumentsError()
      }
    }

    // Why: separate argv entries let Node quote spaces without breaking cmd.
    if (options.detachedGui) {
      // Why: empty title (`""`) is required so `start` does not treat the first
      // quoted path as a window title; `/B` avoids a new console window.
      return {
        spawnCmd: getCmdExePath(),
        spawnArgs: ['/d', '/c', 'start', '""', '/B', command, ...args]
      }
    }
    return { spawnCmd: getCmdExePath(), spawnArgs: ['/d', '/c', command, ...args] }
  }
  return { spawnCmd: command, spawnArgs: args }
}
