import { join, basename } from 'node:path'
import { mkdirSync, existsSync, readFileSync, writeFileSync } from 'node:fs'
import { fishHistorySessionName, resolveFishHistoryFilePath } from './fish-history-session'
import { parseWslPath, toLinuxPath } from './wsl'
import { getHistoryRoot, getHistoryRootWsl, hashWorktreeId } from './terminal-history-paths'

type ShellKind = 'zsh' | 'bash' | 'fish' | 'pwsh' | 'powershell' | 'cmd' | 'unknown'

// ─── Shell Detection ───────────────────────────────────────────────

/** Resolve the shell kind from a shell binary path.
 *  Uses basename + prefix matching to handle versioned names like `bash-5.2`
 *  and nix-store paths like `/nix/store/.../bin/zsh`. */
export function resolveShellKind(shellPath: string): ShellKind {
  const name = basename(shellPath).toLowerCase()
  if (name.startsWith('zsh')) {
    return 'zsh'
  }
  if (name.startsWith('bash')) {
    return 'bash'
  }
  if (name.startsWith('fish')) {
    return 'fish'
  }
  if (name === 'pwsh' || name === 'pwsh.exe') {
    return 'pwsh'
  }
  if (name === 'powershell' || name === 'powershell.exe') {
    return 'powershell'
  }
  if (name === 'cmd' || name === 'cmd.exe') {
    return 'cmd'
  }
  return 'unknown'
}

/** Map shell kind to the filename used inside the history directory.
 *  fish is absent on purpose: it ignores HISTFILE and keeps history in its own
 *  data dir keyed by session name (see fish-history-session.ts). */
function historyFilename(shell: ShellKind): string | null {
  switch (shell) {
    case 'zsh':
      return 'zsh_history'
    case 'bash':
      return 'bash_history'
    // Phase 2: PowerShell and cmd use different mechanisms
    case 'fish':
    case 'pwsh':
    case 'powershell':
    case 'cmd':
    case 'unknown':
      return null
  }
}

// ─── Directory Management ──────────────────────────────────────────

/** Ensure the history directory exists for a given worktree hash.
 *  Returns the directory path, or null if creation failed. */
export function ensureHistoryDir(worktreeHash: string, wslDistro?: string): string | null {
  try {
    const root = wslDistro ? getHistoryRootWsl(wslDistro) : getHistoryRoot()
    const dir = join(root, worktreeHash)
    mkdirSync(dir, { recursive: true, mode: 0o700 })
    return dir
  } catch (err) {
    console.warn(
      `[pty:history] Failed to create history directory: ${err instanceof Error ? err.message : String(err)}`
    )
    return null
  }
}

/** Write meta.json alongside history files, for debuggability and for GC.
 *  `fishSession` is load-bearing, not diagnostic: fish history lives outside this
 *  directory, so deletion can only find it by the name recorded here. */
function writeMetaFile(
  dir: string,
  worktreeId: string,
  fish?: { session: string; historyPath: string | null }
): void {
  try {
    const metaPath = join(dir, 'meta.json')
    const existing = existsSync(metaPath) ? readHistoryMeta(dir) : null
    if (
      existing &&
      (!fish ||
        (existing.fishSession === fish.session &&
          existing.fishHistoryPath === (fish.historyPath ?? undefined)))
    ) {
      return
    }
    writeFileSync(
      metaPath,
      JSON.stringify({
        worktreeId,
        createdAt: existing?.createdAt ?? new Date().toISOString(),
        ...(fish ? { fishSession: fish.session } : {}),
        ...(fish?.historyPath ? { fishHistoryPath: fish.historyPath } : {})
      }),
      { mode: 0o600 }
    )
  } catch {
    // Non-fatal — a missing meta.json only costs GC attribution.
  }
}

export type HistoryDirMeta = {
  worktreeId?: string
  createdAt?: string
  /** fish session name whose history file lives in the user's fish data dir. */
  fishSession?: string
  /** That file's path resolved from the PTY's spawn env, which the main process env can contradict. */
  fishHistoryPath?: string
}

/** Read one history directory's meta.json, or null when it is absent or unparseable. */
export function readHistoryMeta(dir: string): HistoryDirMeta | null {
  try {
    return JSON.parse(readFileSync(join(dir, 'meta.json'), 'utf-8')) as HistoryDirMeta
  } catch {
    return null
  }
}

// ─── Environment Injection ─────────────────────────────────────────

export type HistoryInjectionResult = {
  shell: ShellKind
  histFile: string | null
  /** fish session name exported as `fish_history`; null when fish is not the shell. */
  fishSession: string | null
  /** Worktree history dir as the spawned shell sees it (Linux-visible under WSL). */
  historyDir: string | null
}

/** Build shell-specific history env overrides for a PTY spawn.
 *  Returns the injection result for diagnostics logging.
 *
 *  Why this is the industry-standard approach: Ghostty, Kitty, and VS Code
 *  all use check-before-set for HISTFILE. The major zsh frameworks (oh-my-zsh,
 *  Prezto) guard their HISTFILE assignments, so env-var injection works for
 *  the vast majority of users (see design doc §9). */
export function injectHistoryEnv(
  spawnEnv: Record<string, string>,
  worktreeId: string,
  shellPath: string,
  cwd: string,
  options: { wslDistro?: string | null } = {}
): HistoryInjectionResult {
  const shell = resolveShellKind(shellPath)
  const result: HistoryInjectionResult = {
    shell,
    histFile: null,
    fishSession: null,
    historyDir: null
  }

  const filename = historyFilename(shell)
  if (!filename && shell !== 'fish') {
    // Unknown shell or Phase 2 shell (pwsh, cmd) — leave unchanged.
    return result
  }

  // Check-before-set: if the caller already provided the shell's history knob,
  // preserve it. Same pattern Ghostty, Kitty, and VS Code use for HISTFILE (§6).
  if (shell === 'fish' ? spawnEnv.fish_history : spawnEnv.HISTFILE) {
    return result
  }

  const worktreeHash = hashWorktreeId(worktreeId)

  // WSL: store under a separate root keyed by distro, and convert the
  // HISTFILE path to a Linux-visible /mnt/... path for the inner shell.
  const wslInfo = process.platform === 'win32' ? parseWslPath(cwd) : null
  const wslDistro = wslInfo?.distro ?? options.wslDistro?.trim()
  const histDir = ensureHistoryDir(worktreeHash, wslDistro)
  if (!histDir) {
    // Directory creation failed — degrade gracefully to shared history.
    return result
  }

  if (!filename) {
    // fish: the directory holds no history, only the meta.json that lets deletion
    // find the session file fish keeps in its own data dir. fish never runs as the
    // inner WSL shell, so histDir needs no /mnt conversion here.
    const session = fishHistorySessionName(worktreeHash)
    // Resolve from the SPAWN env: that is the XDG_DATA_HOME/HOME fish will see,
    // which need not match the one this process was launched with.
    writeMetaFile(histDir, worktreeId, {
      session,
      historyPath: resolveFishHistoryFilePath(session, spawnEnv)
    })
    spawnEnv.fish_history = session
    result.fishSession = session
    result.historyDir = histDir
    return result
  }

  writeMetaFile(histDir, worktreeId)

  const histFilePath = join(histDir, filename)

  // For WSL, convert the Windows path to a Linux-visible path.
  spawnEnv.HISTFILE = wslDistro ? toLinuxPath(histFilePath) : histFilePath

  result.histFile = spawnEnv.HISTFILE
  result.historyDir = spawnEnv.HISTFILE.replace(/[/\\][^/\\]+$/, '')
  return result
}

/** Re-point the history env when shell fallback changes the shell kind — e.g. zsh
 *  fails and bash takes over, so HISTFILE must name bash_history. A fish primary
 *  injected `fish_history` instead, which the fallback shell cannot use. */
export function updateHistoryEnvForFallback(
  spawnEnv: Record<string, string>,
  fallbackShellPath: string,
  injected: HistoryInjectionResult
): void {
  // Only ever undo what this spawn injected; a caller-supplied value stays.
  if (injected.fishSession && spawnEnv.fish_history === injected.fishSession) {
    delete spawnEnv.fish_history
  }
  if (!injected.historyDir) {
    return
  }

  const newFilename = historyFilename(resolveShellKind(fallbackShellPath))
  if (!newFilename) {
    // Fallback to an unknown shell — drop the override so it uses its own default.
    delete spawnEnv.HISTFILE
    return
  }
  spawnEnv.HISTFILE = `${injected.historyDir}/${newFilename}`
}

/** Log the history injection result for diagnostics. */
export function logHistoryInjection(worktreeId: string, result: HistoryInjectionResult): void {
  const truncatedId = worktreeId.length > 60 ? `${worktreeId.slice(0, 60)}...` : worktreeId
  console.log(
    `[pty:history] worktreeId=${truncatedId} shell=${result.shell} histFile=${result.histFile ?? 'none'} fishSession=${result.fishSession ?? 'none'}`
  )
}
