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
   * Files that EXIST but could not be read — a permissions problem, a directory, an I/O error.
   *
   * Deliberately not "files that produced no entries": a file that is simply absent is the normal
   * state (ssh creates known_hosts on its own first connect, and most Orca profiles start without
   * one), and it is real evidence that no host is known. A file that exists and refuses to open is
   * the opposite — evidence withheld, so an entry that would have said "this key changed" may be
   * sitting in it. The caller must not record trust while any source is silent that way.
   */
  unreadableFileCount: number
}

export async function loadKnownHostsEvidence(
  files: readonly string[]
): Promise<KnownHostsEvidence> {
  const perFile = await Promise.all(
    files.map(async (path) => {
      try {
        return { entries: parseKnownHosts(await readFile(path, 'utf8')), unreadable: false }
      } catch (err) {
        const absent = (err as NodeJS.ErrnoException).code === 'ENOENT'
        return { entries: [] as KnownHostsEntry[], unreadable: !absent }
      }
    })
  )
  return {
    entries: perFile.flatMap((file) => file.entries),
    unreadableFileCount: perFile.filter((file) => file.unreadable).length
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
