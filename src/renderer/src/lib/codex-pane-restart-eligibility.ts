import { isShellProcess } from '../../../shared/shell-process-detection'
import type { TuiAgent } from '../../../shared/types'
import type { RuntimeTerminalProcessInspection } from '@/runtime/runtime-terminal-inspection'

function normalizeProcessName(processName: string | null): string | null {
  if (!processName) {
    return null
  }
  return processName.toLowerCase().replace(/\.exe$/, '')
}

export function isCodexForegroundProcess(processName: string | null): boolean {
  const normalized = normalizeProcessName(processName)
  if (!normalized) {
    return false
  }
  // Why: node-pty exposes the OS foreground process name, which can be the
  // shipped Codex binary name (for example "codex-aarch64-ap" on macOS)
  // instead of the shell command the user typed. Match on a Codex prefix so
  // account-switch restart prompts still appear for real Codex sessions.
  return normalized === 'codex' || normalized.startsWith('codex-')
}

/**
 * Decides whether a pane may be shown a Codex account-restart prompt.
 *
 * Why this is not just a foreground-name match: Windows reports the DEEPEST
 * process in the PTY tree, so an Orca "Codex" pane running a subagent reads as
 * `pwsh -> node -> codex.exe -> claude.exe` => "claude" and was filtered out
 * before the stale-account registry was ever consulted. `launchAgent` is
 * recorded metadata (Orca started Codex in this tab), not a repaintable label,
 * so it survives that. It is deliberately paired with a non-shell foreground:
 * a restart notice makes the pane drop every keystroke, so a pane the user has
 * exited back to its shell prompt must never be marked.
 */
export function isCodexRestartEligiblePane(args: {
  inspection: RuntimeTerminalProcessInspection
  launchAgent: TuiAgent | undefined
}): boolean {
  const { foregroundProcess, hasChildProcesses, unavailable } = args.inspection
  if (unavailable === true) {
    return false
  }
  if (isCodexForegroundProcess(foregroundProcess)) {
    return true
  }
  if (args.launchAgent !== 'codex' || foregroundProcess === null) {
    return false
  }
  return hasChildProcesses && !isShellProcess(foregroundProcess)
}
