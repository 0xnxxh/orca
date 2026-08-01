import { existsSync, mkdirSync, readFileSync, realpathSync } from 'node:fs'
import { readFile } from 'node:fs/promises'
import { homedir } from 'node:os'
import { basename, dirname, join, resolve } from 'node:path'
import { realpathNativeAsync, writeFileAtomically } from './codex-accounts/fs-utils'
import { getOrcaManagedCodexHomePath } from './codex/codex-home-paths'
import { upsertProjectTrustLevel } from './codex/config-toml-trust'

export type AgentTrustPreset = 'cursor' | 'copilot' | 'codex'

/**
 * Pre-mark a workspace as trusted for cursor-agent, GitHub Copilot CLI, or
 * Codex so the agent's "Do you trust this folder?" menu does not fire on
 * first launch.
 *
 * Why: Orca's "drop URL into agent input as a draft" flow injects the URL
 * via bracketed-paste once the TUI is up. If the trust menu intercepts the
 * keystrokes (each menu reads a single character or numbered option), the
 * paste either selects an arbitrary option or quits the session. Pre-writing
 * the same trust artifacts that the agent writes after the user accepts is
 * the only documented bypass — both CLIs read these files at startup before
 * showing the menu.
 *
 * Side note: a `--trust`-style CLI flag exists in cursor-agent but only
 * applies in `--print/headless` mode (per its --help). Copilot has no
 * documented flag at all (verified against @github/copilot 1.0.32 bundle).
 * Codex's `--dangerously-bypass-approvals-and-sandbox` would also change
 * approval/sandbox policy, so it is not equivalent to "trust this project".
 */

/**
 * Cursor's CLI keeps a per-workspace trust marker at:
 *   ~/.cursor/projects/<slug>/.workspace-trusted
 * where <slug> is the absolute path with the leading `/` stripped and
 * remaining `/` replaced with `-`. The file payload is `{ trustedAt,
 * workspacePath }`. Verified against the cursor-agent CLI bundle
 * (versions/2026.04.17-787b533/index.ts: `_=".workspace-trusted"`, slug
 * derived via the same util that resolves `~/.cursor/projects/<slug>`).
 */
export function markCursorWorkspaceTrusted(workspacePath: string): void {
  writeCursorTrustMarker(canonicalize(workspacePath))
}

/**
 * Main-thread (IPC) twin of markCursorWorkspaceTrusted. Only the workspace
 * realpath — the call that can park on a dead network mount — moves off-thread;
 * the marker write stays synchronous so the main thread remains the serializer
 * against the sync twin and tmp+rename atomicity is preserved.
 */
export async function markCursorWorkspaceTrustedAsync(workspacePath: string): Promise<void> {
  writeCursorTrustMarker(await canonicalizeAsync(workspacePath))
}

function writeCursorTrustMarker(absPath: string): void {
  const slug = cursorWorkspaceSlug(absPath)
  if (!slug) {
    return
  }
  const trustDir = join(homedir(), '.cursor', 'projects', slug)
  const trustFile = join(trustDir, '.workspace-trusted')
  if (existsSync(trustFile)) {
    return
  }
  mkdirSync(trustDir, { recursive: true })
  const payload = JSON.stringify(
    { trustedAt: new Date().toISOString(), workspacePath: absPath },
    null,
    2
  )
  // Why: cursor-agent may be reading this marker concurrently, so publish via
  // tmp+rename — a torn in-place write would look like an empty trust file.
  writeFileAtomically(trustFile, `${payload}\n`)
}

/**
 * GitHub Copilot CLI keeps a global list of trusted folders in
 * ~/.copilot/config.json under `trustedFolders` (verified against the
 * @github/copilot 1.0.32 bundle: `addTrustedFolder` and `isFolderTrusted`
 * both read/write this exact key, and folder comparison is done after a
 * realpath() resolution).
 *
 * We append to the array in-place so unrelated config keys (loggedInUsers,
 * copilotTokens, etc.) survive untouched.
 */
export function markCopilotFolderTrusted(workspacePath: string): void {
  addCopilotTrustedFolder(canonicalize(workspacePath))
}

/**
 * Main-thread (IPC) twin of markCopilotFolderTrusted. The realpath()s of the
 * workspace and of the already-listed folders (any of which can be a stalled
 * mount) run off-thread; the read-modify-write of ~/.copilot/config.json then
 * runs synchronously, so it cannot interleave with the sync twin.
 */
export async function markCopilotFolderTrustedAsync(workspacePath: string): Promise<void> {
  const absPath = await canonicalizeAsync(workspacePath)
  addCopilotTrustedFolder(absPath, await prefetchCanonicalTrustedFolders())
}

/**
 * Best-effort off-thread realpath() of the folders already in config.json. The
 * synchronous read below stays authoritative; this only pre-answers the lookups
 * so a listed dead mount cannot block the main thread.
 */
async function prefetchCanonicalTrustedFolders(): Promise<Map<string, string>> {
  const canonicalByEntry = new Map<string, string>()
  try {
    const parsed: unknown = JSON.parse(
      await readFile(join(homedir(), '.copilot', 'config.json'), 'utf-8')
    )
    const trustedFolders =
      parsed && typeof parsed === 'object'
        ? (parsed as Record<string, unknown>).trustedFolders
        : undefined
    if (!Array.isArray(trustedFolders)) {
      return canonicalByEntry
    }
    await Promise.all(
      trustedFolders.map(async (entry) => {
        if (typeof entry === 'string') {
          canonicalByEntry.set(entry, await canonicalizeAsync(entry))
        }
      })
    )
  } catch {
    // Unreadable or corrupt config: the synchronous pass below decides what to do.
  }
  return canonicalByEntry
}

function addCopilotTrustedFolder(
  absPath: string,
  canonicalByEntry?: ReadonlyMap<string, string>
): void {
  const configDir = join(homedir(), '.copilot')
  const configPath = join(configDir, 'config.json')
  let config: Record<string, unknown> = {}
  try {
    if (existsSync(configPath)) {
      const raw = readFileSync(configPath, 'utf-8')
      const parsed = JSON.parse(raw)
      if (parsed && typeof parsed === 'object') {
        config = parsed as Record<string, unknown>
      }
    }
  } catch {
    // Why: a corrupted config.json is the user's to fix — refuse to overwrite
    // it from this side-effect path. Copilot will rewrite the file itself
    // after the user accepts the trust prompt manually.
    return
  }
  const existing = Array.isArray(config.trustedFolders) ? (config.trustedFolders as unknown[]) : []
  const normalizedExisting = existing.map((entry) =>
    typeof entry === 'string' ? (canonicalByEntry?.get(entry) ?? canonicalize(entry)) : null
  )
  if (normalizedExisting.includes(absPath)) {
    return
  }
  const next = [...existing.filter((e) => typeof e === 'string'), absPath]
  config.trustedFolders = next
  if (!existsSync(configDir)) {
    mkdirSync(configDir, { recursive: true })
  }
  writeFileAtomically(configPath, `${JSON.stringify(config, null, 2)}\n`)
}

/**
 * Codex stores project trust in ~/.codex/config.toml under:
 *   [projects."<realpath>"]
 *   trust_level = "trusted"
 *
 * Verified against codex-rs/tui/src/onboarding/trust_directory.rs and
 * codex-rs/core/src/config/config_tests.rs in the Codex CLI source.
 */
export function markCodexProjectTrusted(workspacePath: string): void {
  writeCodexProjectTrust(resolveCodexProjectTrustRoot(workspacePath))
}

/**
 * Main-thread (IPC) twin of markCodexProjectTrusted. The trust-root resolution
 * (realpath plus the workspace's own .git reads) runs off-thread; the
 * config.toml read-modify-write stays synchronous so it cannot interleave with
 * the sync writers in codex/hook-service.ts that share the same file.
 */
export async function markCodexProjectTrustedAsync(workspacePath: string): Promise<void> {
  writeCodexProjectTrust(await resolveCodexProjectTrustRootAsync(workspacePath))
}

function writeCodexProjectTrust(absPath: string): void {
  // Why: absPath already went through realpath, so skip the extra realpath()s
  // the upsert would otherwise pay on a possibly-stalled workspace path.
  const options = { alreadyCanonical: true }
  upsertProjectTrustLevel(join(homedir(), '.codex', 'config.toml'), absPath, 'trusted', options)
  // Why: Orca-launched Codex runs with an Orca-owned CODEX_HOME, so the trust
  // preset must also update the runtime config Codex will actually read.
  upsertProjectTrustLevel(
    join(getOrcaManagedCodexHomePath(), 'config.toml'),
    absPath,
    'trusted',
    options
  )
}

async function resolveCodexProjectTrustRootAsync(workspacePath: string): Promise<string> {
  const absPath = await canonicalizeAsync(workspacePath)
  try {
    const gitDirReference = (await readFile(join(absPath, '.git'), 'utf-8')).trim()
    if (!gitDirReference.startsWith('gitdir:')) {
      return absPath
    }
    const gitDirPath = gitDirReference.slice('gitdir:'.length).trim()
    if (!gitDirPath) {
      return absPath
    }
    const gitDir = resolve(absPath, gitDirPath)
    const worktreesDir = dirname(gitDir)
    if (basename(worktreesDir) !== 'worktrees') {
      return absPath
    }
    // Why: workspace-controlled .git metadata must not broaden trust without Git's reciprocal link.
    const gitDirBacklink = (await readFile(join(gitDir, 'gitdir'), 'utf-8')).trim()
    if (!gitDirBacklink) {
      return absPath
    }
    const resolvedBacklink = resolve(gitDir, gitDirBacklink)
    const workspaceGitFile = join(absPath, '.git')
    if (
      resolvedBacklink !== workspaceGitFile &&
      (await canonicalizeAsync(resolvedBacklink)) !== (await canonicalizeAsync(workspaceGitFile))
    ) {
      return absPath
    }
    // Why: mirror Codex's validated .git/worktrees/<name> traversal instead of trusting arbitrary commondir contents.
    return await canonicalizeAsync(dirname(dirname(worktreesDir)))
  } catch {
    return absPath
  }
}

function resolveCodexProjectTrustRoot(workspacePath: string): string {
  const absPath = canonicalize(workspacePath)
  try {
    const gitDirReference = readFileSync(join(absPath, '.git'), 'utf-8').trim()
    if (!gitDirReference.startsWith('gitdir:')) {
      return absPath
    }
    const gitDirPath = gitDirReference.slice('gitdir:'.length).trim()
    if (!gitDirPath) {
      return absPath
    }
    const gitDir = resolve(absPath, gitDirPath)
    const worktreesDir = dirname(gitDir)
    if (basename(worktreesDir) !== 'worktrees') {
      return absPath
    }
    // Why: workspace-controlled .git metadata must not broaden trust without Git's reciprocal link.
    const gitDirBacklink = readFileSync(join(gitDir, 'gitdir'), 'utf-8').trim()
    if (!gitDirBacklink) {
      return absPath
    }
    const resolvedBacklink = resolve(gitDir, gitDirBacklink)
    const workspaceGitFile = join(absPath, '.git')
    if (
      resolvedBacklink !== workspaceGitFile &&
      canonicalize(resolvedBacklink) !== canonicalize(workspaceGitFile)
    ) {
      return absPath
    }
    // Why: mirror Codex's validated .git/worktrees/<name> traversal instead of trusting arbitrary commondir contents.
    return canonicalize(dirname(dirname(worktreesDir)))
  } catch {
    return absPath
  }
}

// Why: macOS reports `/tmp/x` and `/private/tmp/x` as the same inode, but both
// Cursor and Copilot's trust comparators run realpath() before the string
// compare. Mirror that so a worktree under a symlinked parent (orca caches
// realpath()'d worktree paths) matches the agent's lookup.
function canonicalize(p: string): string {
  try {
    // Why: realpath already fails ENOENT on a missing path, so an existsSync pre-probe only doubles syscalls.
    return realpathSync.native(p)
  } catch {
    return p
  }
}

async function canonicalizeAsync(p: string): Promise<string> {
  try {
    return await realpathNativeAsync(p)
  } catch {
    return p
  }
}

function cursorWorkspaceSlug(absPath: string): string {
  const stripped = absPath.replace(/^[\\/]+/, '')
  // Why: Windows absolute paths include characters such as ":" that cannot
  // be used in the ~/.cursor/projects/<slug> directory name.
  const slug = stripped.replace(/[\\/:*?"<>|]+/g, '-')
  return slug
}
