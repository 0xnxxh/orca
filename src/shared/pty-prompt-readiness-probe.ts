import type { PtySlaveEchoProbe } from './pty-slave-line-discipline-echo'

// Why this exists: the shell-ready marker is printed by Orca's own wrapper, so it is
// only as durable as the wrapper. An `exec` in a user rc file — what every
// figterm-style integration does (Kiro CLI, Amazon Q, Fig, Warp) — replaces the process
// image, dropping ZDOTDIR/--rcfile, so no wrapper file is ever read again and the marker
// never arrives (#13767). The line discipline cannot be lost that way: zle/readline
// clear ECHO on the slave exactly when the line editor takes the tty at the first
// prompt — after a slow rc, and after an exec. Polling it turns a stripped wrapper into
// a short wait instead of the full shell-ready timeout.

/** Why: a healthy wrapper marks ready far inside this, so the normal path never spawns
 *  an `stty` — and a shell that legitimately reads input during startup is past that
 *  window before the fallback can mistake its raw mode for a prompt. */
export const PROMPT_READINESS_PROBE_GRACE_MS = 750
export const PROMPT_READINESS_PROBE_INTERVAL_MS = 250

export type PtyPromptReadinessProbeOptions = {
  probe: PtySlaveEchoProbe
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
      void tick()
    }, delayMs)
  }

  const tick = async (): Promise<void> => {
    if (stopped) {
      return
    }
    const state = await options.probe()
    // Why re-check: the probe awaits a child process, so a stop can land mid-flight.
    if (stopped) {
      return
    }
    // Why only 'quiet': `unknown` means the probe could not read the slave, and reading
    // that as ready would flush a startup command into a shell that cannot take it.
    if (state === 'quiet') {
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
