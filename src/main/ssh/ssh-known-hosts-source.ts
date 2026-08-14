/**
 * Where `known_hosts` entries come from for one lookup.
 *
 * Reading the user's real files is the entire migration story — most developers already verified
 * their hosts through `ssh` and `git`. We only read; writing to a file shared with every other SSH
 * tool on the machine is out of scope. See docs/reference/ssh-host-key-verification.md (D1, D2).
 */
import { readFile } from 'node:fs/promises'
import { homedir } from 'node:os'
import { join } from 'node:path'
import type { SshResolvedConfig } from './ssh-g-config-resolution'
import { parseKnownHosts, type KnownHostsEntry } from './ssh-known-hosts'

/** OpenSSH's explicit opt-out for one list; the other list still applies. */
const EXPLICIT_NONE = 'none'

/** Used when `ssh -G` told us nothing — never "no trust source". */
export function defaultKnownHostsFiles(): string[] {
  const home = homedir()
  return [join(home, '.ssh', 'known_hosts'), join(home, '.ssh', 'known_hosts2')]
}

export function resolveKnownHostsFiles(resolved: SshResolvedConfig | null): string[] {
  const reported = resolved
    ? [...resolved.userKnownHostsFiles, ...resolved.globalKnownHostsFiles]
    : []
  // No `ssh`, a non-zero exit or a timeout must not turn a host the user already verified into
  // first contact, so an empty report falls back rather than reading nothing.
  if (reported.length === 0) {
    return defaultKnownHostsFiles()
  }
  return [...new Set(reported.filter((path) => path !== EXPLICIT_NONE))]
}

async function readEntries(path: string): Promise<KnownHostsEntry[]> {
  try {
    return parseKnownHosts(await readFile(path, 'utf8'))
  } catch {
    // Missing, unreadable or a directory. Skipping is not failing open: a file we cannot read
    // contributes no trust, and the remaining files still decide.
    return []
  }
}

/**
 * The union across every file. The caller runs `matchKnownHosts` once over the result, so an exact
 * hit in any file wins and a disagreeing entry in another file is not a mismatch.
 */
export async function loadKnownHostsEntries(
  files: readonly string[]
): Promise<KnownHostsEntry[]> {
  const perFile = await Promise.all(files.map((path) => readEntries(path)))
  return perFile.flat()
}

/**
 * The name the lookup keys on: `HostKeyAlias` when set, else the resolved hostname, else the host
 * ssh2 dials. Never the Orca label — bastions tunnelled through `localhost:port` depend on the
 * alias, and a label keys on nothing `ssh` ever wrote.
 */
export function resolveKnownHostsLookupHost(
  resolved: SshResolvedConfig | null,
  dialedHost: string
): string {
  return resolved?.hostKeyAlias || resolved?.hostname || dialedHost
}
