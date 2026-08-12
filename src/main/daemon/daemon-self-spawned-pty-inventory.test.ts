import { describe, expect, it } from 'vitest'
import { readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'

/**
 * The evidence module decides whether a daemon still hosts user terminals by looking at its
 * process tree, and must discount the PTYs the daemon opens for itself. That exclusion list
 * is only safe while it is complete — a self-spawned PTY nobody excluded reads as user work
 * and holds a daemon that owns nothing, which is how the list grew a reviewer at a time.
 *
 * So pin the input instead of the list: every PTY the daemon can open, enumerated from the
 * source. A new spawn site fails this test until someone decides which side it belongs on.
 */
const KNOWN_DAEMON_PTY_SPAWN_SITES = [
  // The user's terminal — the thing the evidence exists to protect.
  { file: 'pty-subprocess.ts', argv: 'wrapped.file, wrapped.args', hosted: true },
  // checkPtySpawnHealth
  { file: 'pty-subprocess.ts', argv: "'/bin/sh', ['-c', 'exit 0']", hosted: false },
  // warmWindowsConptyOnce
  { file: 'windows-conpty-warmup.ts', argv: "COMSPEC || 'cmd.exe', ['/c', 'exit']", hosted: false }
]

describe('daemon self-spawned PTY inventory', () => {
  it('has no PTY spawn site the ownership evidence has not accounted for', () => {
    const daemonDir = join(import.meta.dirname)
    const sites = readdirSync(daemonDir)
      .filter((name) => name.endsWith('.ts') && !name.includes('.test.'))
      .flatMap((name) => {
        const source = readFileSync(join(daemonDir, name), 'utf8')
        return [...source.matchAll(/(?:pty\.spawn|spawnPty)\s*\(/g)]
          .filter((match) => !/typeof pty\.spawn/.test(source.slice(match.index - 80, match.index)))
          .map(() => name)
      })

    expect(sites.sort()).toEqual(KNOWN_DAEMON_PTY_SPAWN_SITES.map((site) => site.file).sort())
  })
})
