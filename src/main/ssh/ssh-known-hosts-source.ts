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

/**
 * The union across every file. The caller runs `matchKnownHosts` once over the result, so an exact
 * hit in any file wins and a disagreeing entry in another file is not a mismatch.
 */
export async function loadKnownHostsEntries(files: readonly string[]): Promise<KnownHostsEntry[]> {
  return (await loadKnownHostsEvidence(files)).entries
}

export type KnownHostsEvidence = {
  entries: KnownHostsEntry[]
  /**
   * How many configured files we could actually read. Zero is NOT the same as "this host is
   * unknown": if every source is unreadable we have no evidence at all, and treating that as first
   * contact would silently accept a changed key. The caller must refuse to record trust then.
   */
  readableFileCount: number
  configuredFileCount: number
}

export async function loadKnownHostsEvidence(
  files: readonly string[]
): Promise<KnownHostsEvidence> {
  const perFile = await Promise.all(
    files.map(async (path) => {
      try {
        return { entries: parseKnownHosts(await readFile(path, 'utf8')), readable: true }
      } catch {
        // Missing, unreadable or a directory. A file we cannot read contributes no trust; the
        // remaining files still decide, and the count tells the caller whether any spoke at all.
        return { entries: [] as KnownHostsEntry[], readable: false }
      }
    })
  )
  return {
    entries: perFile.flatMap((file) => file.entries),
    readableFileCount: perFile.filter((file) => file.readable).length,
    configuredFileCount: files.length
  }
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
  // Deliberately NOT `resolved.hostname`: `ssh -G` echoes its own argument back as `hostname` when
  // no Host block matches, which for a manual target is the Orca label. Keying on that consults a
  // name `ssh` never wrote, so the real host's entries are missed entirely and an impersonated
  // host reads as first contact. `dialedHost` is what ssh2 actually connects to, with HostName
  // resolution already applied by buildConnectConfig.
  return resolved?.hostKeyAlias || dialedHost
}
