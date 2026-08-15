// Why: Gemini CLI was removed, but managed hook entries remain in
// ~/.gemini/settings.json and ~/.orca/agent-hooks/gemini-hook.* and still POST
// to /hook/gemini (404). Antigravity intentionally lives under ~/.gemini too —
// only strip commands that match the managed gemini-hook script name.

import { unlinkSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'
import type { SFTPWrapper } from 'ssh2'
import {
  createManagedCommandMatcher,
  getSharedManagedScriptPath,
  readHooksJson,
  removeManagedCommands,
  writeHooksJson,
  type HooksConfig
} from './installer-utils'
import { readHooksJsonRemote, writeHooksJsonRemote, unlink } from './installer-utils-remote'

// Why: installs emitted .sh (POSIX) or .cmd/.ps1 (Windows); sweep every variant.
const SCRIPT_FILES = ['gemini-hook.sh', 'gemini-hook.cmd', 'gemini-hook.ps1'] as const
const isManagedCommand = createManagedCommandMatcher('gemini-hook.sh')

type ManagedGeminiHookStrip =
  /** Audited and free of managed entries — safe to sweep the scripts. */
  | { outcome: 'clean' }
  | { outcome: 'rewritten'; config: HooksConfig }
  /** A shape Orca never wrote and cannot audit; the script sweep must not run. */
  | { outcome: 'unverified' }

function stripManagedGeminiHooks(config: HooksConfig): ManagedGeminiHookStrip {
  const hooks = config.hooks
  if (!hooks) {
    return { outcome: 'clean' }
  }
  // Why: Object.entries walks an array by index and reads nothing useful off a
  // scalar, so either shape would silently report "clean" and unlink a script a
  // surviving entry still points at — the exact failure the sweep gate prevents.
  if (typeof hooks !== 'object' || Array.isArray(hooks)) {
    return { outcome: 'unverified' }
  }
  const nextHooks = { ...hooks }
  let changed = false
  for (const [eventName, definitions] of Object.entries(hooks)) {
    if (!Array.isArray(definitions)) {
      // Same reasoning per event: unreadable entries cannot be certified clean.
      return { outcome: 'unverified' }
    }
    const cleaned = removeManagedCommands(definitions, isManagedCommand)
    if (cleaned.length === definitions.length) {
      continue
    }
    changed = true
    if (cleaned.length === 0) {
      delete nextHooks[eventName]
    } else {
      nextHooks[eventName] = cleaned
    }
  }
  return changed
    ? { outcome: 'rewritten', config: { ...config, hooks: nextHooks } }
    : { outcome: 'clean' }
}

/**
 * Why gate the unlink: a config Orca could not parse (JSONC comments) or could
 * not rewrite may still hold a live entry pointing at the script. Deleting it
 * then turns a 404 POST into empty stdout, which a JSON-expecting Gemini CLI
 * reads as a broken hook — worse than the stale endpoint. Only sweep the
 * scripts once the settings file is known to be free of managed entries.
 */
export function removeRetiredGeminiManagedHooksLocal(): void {
  const configPath = join(homedir(), '.gemini', 'settings.json')
  const config = readHooksJson(configPath)
  if (!config) {
    return
  }
  const cleaned = stripManagedGeminiHooks(config)
  if (cleaned.outcome === 'unverified') {
    return
  }
  if (cleaned.outcome === 'rewritten') {
    try {
      writeHooksJson(configPath, cleaned.config)
    } catch {
      return
    }
  }
  for (const fileName of SCRIPT_FILES) {
    try {
      unlinkSync(getSharedManagedScriptPath(fileName))
    } catch {
      // Missing file or permission error; settings cleanup already stops the POSTs.
    }
  }
}

/** Idempotent remote (SSH/WSL) cleanup mirroring local remove for Gemini CLI hooks. */
export async function removeRetiredGeminiManagedHooksRemote(
  sftp: SFTPWrapper,
  remoteHome: string
): Promise<void> {
  const home = remoteHome.replace(/\/$/, '')
  const configPath = `${home}/.gemini/settings.json`
  try {
    const config = await readHooksJsonRemote(sftp, configPath)
    if (!config) {
      return
    }
    const cleaned = stripManagedGeminiHooks(config)
    if (cleaned.outcome === 'unverified') {
      return
    }
    if (cleaned.outcome === 'rewritten') {
      await writeHooksJsonRemote(sftp, configPath, cleaned.config)
    }
  } catch {
    // Best-effort: do not block remote hook install for other agents. Leave the
    // scripts in place so any surviving entry still resolves (see local note).
    return
  }
  for (const fileName of SCRIPT_FILES) {
    try {
      await unlink(sftp, `${home}/.orca/agent-hooks/${fileName}`)
    } catch {
      // Missing file or permission errors are non-fatal for upgrade cleanup.
    }
  }
}
