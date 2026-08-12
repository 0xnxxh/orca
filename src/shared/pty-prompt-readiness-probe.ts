import type {
  PtySlaveLineEditorProbe,
  PtySlaveLineEditorState
} from './pty-slave-line-discipline-echo'

// Why this exists: the shell-ready marker is printed by Orca's own wrapper, so it is
// only as durable as the wrapper. An `exec` in a user rc file — what every
// figterm-style integration does (Kiro CLI, Amazon Q, Fig, Warp) — replaces the process
// image, dropping ZDOTDIR/--rcfile, so no wrapper file is ever read again and the marker
// never arrives (#13767). The line discipline cannot be lost that way: zle/readline take
// the slave out of canonical mode exactly when the line editor owns the tty at the first
// prompt — after a slow rc, and after an exec. Polling it turns a stripped wrapper into
// a short wait instead of the full shell-ready timeout.

/** Why: a healthy wrapper marks ready far inside this, so the normal path never spawns
 *  an `stty` at all. */
export const PROMPT_READINESS_PROBE_GRACE_MS = 750
export const PROMPT_READINESS_PROBE_INTERVAL_MS = 250

export type PtyPromptReadinessProbeOptions = {
  probe: PtySlaveLineEditorProbe
  /** Fired at most once, when the slave's line editor has taken the tty. */
  onPromptReady: () => void
  graceMs?: number
  intervalMs?: number
}

/** Returns a stop function; safe to call after the probe has already fired. */
export function startPtyPromptReadinessProbe(options: PtyPromptReadinessProbeOptions): () => void {
  const graceMs = options.graceMs ?? PROMPT_READINESS_PROBE_GRACE_MS
  const intervalMs = options.intervalMs ?? PROMPT_READINESS_PROBE_INTERVAL_MS
  let stopped = false
  let timer: ReturnType<typeof setTimeout> | null = null

  const schedule = (delayMs: number): void => {
    timer = setTimeout(() => {
      timer = null
      // Why catch: this is fire-and-forget off a timer, so a throwing onPromptReady
      // would otherwise surface as an unhandled rejection and take the daemon down.
      // Readiness then degrades to the shell-ready timeout, which is the old behavior.
      void tick().catch(() => {})
    }, delayMs)
  }

  const tick = async (): Promise<void> => {
    if (stopped) {
      return
    }
    let state: PtySlaveLineEditorState
    try {
      state = await options.probe()
    } catch {
      // Why: a probe that rejects is no evidence of a prompt — keep polling, and let the
      // shell-ready timeout remain the backstop.
      state = 'unknown'
    }
    // Why re-check: the probe awaits a child process, so a stop can land mid-flight.
    if (stopped) {
      return
    }
    // Why only 'line-editor': `unknown` means the probe could not read the slave, and
    // `cooked` covers a startup file's own `read` — flushing into either would push a
    // startup command at a shell that cannot take it (or into a password prompt).
    if (state === 'line-editor') {
      stopped = true
      options.onPromptReady()
      return
    }
    schedule(intervalMs)
  }

  schedule(graceMs)

  return () => {
    stopped = true
    if (timer) {
      clearTimeout(timer)
      timer = null
    }
  }
}
