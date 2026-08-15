/**
 * Shell-ready startup command support for local PTYs.
 *
 * Why: startup commands must wait until the shell has fully initialized. Provides shell wrapper
 * rcfiles that emit an OSC 777 marker after startup, plus a scanner that detects it.
 */
import { basename, win32 as pathWin32 } from 'node:path'
import type * as pty from 'node-pty'
import {
  encodePowerShellCommand,
  getPowerShellOsc133Bootstrap,
  isPowerShellExecutableName
} from '../powershell-osc133-bootstrap'
import { getFishCodexShellLaunchPreflight } from '../pty/codex-shell-launch-preflight'
import { buildStartupCommandSubmission } from '../../shared/startup-command-submission'
import { getFishShellReadyInitCommand } from '../shell-templates'
import { SHELL_READY_MARKER_ESCAPED } from './shell-ready-wrapper-rcfiles'
import {
  getShellReadyWrapperRoot,
  resolveOriginalZdotdir,
  resolveOriginalZshenvSourceDir
} from './shell-ready-wrapper-paths'
import { ensureShellReadyWrappers } from './shell-ready-wrapper-writer'

const STARTUP_COMMAND_READY_MAX_WAIT_MS = 1500
const POST_SHELL_READY_STARTUP_COMMAND_DELAY_MS = 30
const POST_SHELL_READY_STARTUP_COMMAND_FALLBACK_MS = 200

export type ShellReadySignal = {
  postMarkerBytesObserved: boolean
}

// ── Shell launch config ─────────────────────────────────────────────

export type ShellReadyLaunchConfig = {
  args: string[] | null
  env: Record<string, string>
  supportsReadyMarker: boolean
}

function getWrappedShellLaunchConfig(
  shellPath: string,
  options: { emitReadyMarker: boolean }
): ShellReadyLaunchConfig {
  const shellName = pathWin32.basename(basename(shellPath)).toLowerCase()

  if (shellName === 'zsh') {
    ensureShellReadyWrappers()
    return {
      args: ['-l'],
      env: {
        ORCA_ORIG_ZDOTDIR: resolveOriginalZdotdir(),
        ORCA_ZSHENV_SOURCE_DIR: resolveOriginalZshenvSourceDir(),
        ZDOTDIR: `${getShellReadyWrapperRoot()}/zsh`,
        ORCA_SHELL_READY_MARKER: options.emitReadyMarker ? '1' : '0',
        ORCA_SHELL_STARTUP_IDENTITY: options.emitReadyMarker ? '1' : '0'
      },
      supportsReadyMarker: options.emitReadyMarker
    }
  }

  if (shellName === 'bash') {
    ensureShellReadyWrappers()
    return {
      args: ['--rcfile', `${getShellReadyWrapperRoot()}/bash/rcfile`],
      env: {
        ORCA_SHELL_READY_MARKER: options.emitReadyMarker ? '1' : '0',
        ORCA_SHELL_STARTUP_IDENTITY: options.emitReadyMarker ? '1' : '0'
      },
      supportsReadyMarker: options.emitReadyMarker
    }
  }

  if (isPowerShellExecutableName(shellName)) {
    return {
      args: [
        '-NoLogo',
        '-NoExit',
        '-EncodedCommand',
        encodePowerShellCommand(getPowerShellOsc133Bootstrap())
      ],
      env: {},
      supportsReadyMarker: false
    }
  }

  // Why: mirrors daemon/shell-ready.ts; markerless fish stays unwrapped.
  if (shellName === 'fish' && options.emitReadyMarker) {
    return {
      args: [
        '-l',
        '-C',
        `${getFishShellReadyInitCommand(SHELL_READY_MARKER_ESCAPED)}\n${getFishCodexShellLaunchPreflight()}`
      ],
      env: { ORCA_SHELL_READY_MARKER: '1' },
      supportsReadyMarker: true
    }
  }

  return {
    args: null,
    env: {},
    supportsReadyMarker: false
  }
}

export function getShellReadyLaunchConfig(shellPath: string): ShellReadyLaunchConfig {
  return getWrappedShellLaunchConfig(shellPath, { emitReadyMarker: true })
}

export function getMarkerlessShellLaunchConfig(shellPath: string): ShellReadyLaunchConfig {
  return getWrappedShellLaunchConfig(shellPath, { emitReadyMarker: false })
}

// ── Startup command writer ──────────────────────────────────────────

export function writeStartupCommandWhenShellReady(
  readyPromise: Promise<void | ShellReadySignal>,
  proc: pty.IPty,
  startupCommand: string,
  onExit: (cleanup: () => void) => void,
  // Why: only shells with bracketed-paste active (see isBracketedPasteSafeShell) accept the wrapper; others use the raw path so ESC[200~ isn't echoed.
  options: { bracketedPasteSafe?: boolean } = {}
): void {
  let sent = false
  let postReadyTimer: ReturnType<typeof setTimeout> | null = null
  let postReadyDataDisposable: { dispose: () => void } | null = null

  const cleanup = (): void => {
    sent = true
    if (postReadyTimer !== null) {
      clearTimeout(postReadyTimer)
      postReadyTimer = null
    }
    postReadyDataDisposable?.dispose()
    postReadyDataDisposable = null
  }

  const flush = (): void => {
    if (sent) {
      return
    }
    sent = true
    postReadyDataDisposable?.dispose()
    postReadyDataDisposable = null
    if (postReadyTimer !== null) {
      clearTimeout(postReadyTimer)
      postReadyTimer = null
    }
    // Why: run in the same interactive shell (not `shell -c`) so the session survives after the agent exits.
    // Why CR on Windows: PSReadLine/cmd.exe submit on `\r`, not LF; POSIX treats either as Enter under ICRNL.
    const submit = process.platform === 'win32' ? '\r' : '\n'
    // Why: single write after the ready barrier avoids incremental-paste char drops; multiline is bracketed-paste wrapped so newlines don't submit early.
    proc.write(
      buildStartupCommandSubmission(startupCommand, {
        submit,
        bracketedPasteSafe: options.bracketedPasteSafe === true
      })
    )
  }

  const schedulePostReadyFlush = (): void => {
    postReadyTimer = setTimeout(flush, POST_SHELL_READY_STARTUP_COMMAND_DELAY_MS)
  }

  readyPromise.then((signal) => {
    if (sent) {
      return
    }
    // Why: marker fires from precmd before the line editor takes the PTY out of ECHO; writing now double-echoes the command, so settle first.
    if (signal?.postMarkerBytesObserved === true) {
      schedulePostReadyFlush()
      return
    }
    postReadyDataDisposable = proc.onData(() => {
      postReadyDataDisposable?.dispose()
      postReadyDataDisposable = null
      if (postReadyTimer !== null) {
        clearTimeout(postReadyTimer)
      }
      schedulePostReadyFlush()
    })
    postReadyTimer = setTimeout(() => {
      postReadyDataDisposable?.dispose()
      postReadyDataDisposable = null
      postReadyTimer = null
      flush()
    }, POST_SHELL_READY_STARTUP_COMMAND_FALLBACK_MS)
  })
  onExit(cleanup)
}

export { STARTUP_COMMAND_READY_MAX_WAIT_MS }
