import { homedir } from 'node:os'
import { join } from 'node:path'

/**
 * Windows OpenSSH's own placeholder for the system config directory's parent.
 *
 * It prints this token UNEXPANDED from `ssh -G` — captured from a real Windows host:
 * `globalknownhostsfile __PROGRAMDATA__\ssh/ssh_known_hosts __PROGRAMDATA__\ssh/ssh_known_hosts2`.
 * Passed through as a literal it misses with ENOENT, and an absent file is indistinguishable from
 * "no host is known there", so a site-managed `known_hosts` would be silently invisible — including
 * one holding a rotated key that should have produced a mismatch.
 */
const PROGRAMDATA_TOKEN = '__PROGRAMDATA__'

export function resolveSshConfigHomePath(filepath: string): string {
  if (filepath.startsWith(PROGRAMDATA_TOKEN)) {
    // Left alone when the variable is unset rather than guessed: a wrong path reads as "absent",
    // which is the failure this expansion exists to prevent, so it must not be invented.
    const programData = process.env.ProgramData
    return programData ? join(programData, filepath.slice(PROGRAMDATA_TOKEN.length)) : filepath
  }
  if (filepath === '~') {
    return homedir()
  }
  if (filepath.startsWith('~/') || filepath.startsWith('~\\')) {
    return join(
      homedir(),
      ...filepath
        .slice(2)
        .split(/[\\/]+/)
        .filter(Boolean)
    )
  }
  return filepath
}
