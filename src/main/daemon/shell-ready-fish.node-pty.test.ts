/**
 * Real-fish PTY coverage for the daemon shell-ready launch config.
 *
 * Why its own file: these two cases need a live node-pty fish and the terminal
 * capability replies that keep fish from swallowing the command written after
 * its first prompt. That machinery does not belong in the string-level launch
 * config suite next door.
 */
import { spawnSync } from 'node:child_process'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type * as ShellReadyModule from './shell-ready'

async function importFreshShellReady(): Promise<typeof ShellReadyModule> {
  vi.resetModules()
  return import('./shell-ready')
}

const describePosix = process.platform === 'win32' ? describe.skip : describe
const hasFish = process.platform !== 'win32' && spawnSync('fish', ['--version']).status === 0
const itWithFish = hasFish ? it : it.skip

const SHELL_READY_MARKER_OUTPUT = '\x1b]777;orca-shell-ready\x07'

/** Minimal xterm.js-shaped answers to the capability queries fish emits at startup
 *  and again around every prompt. */
const TERMINAL_QUERY_REPLIES: readonly (readonly [string, string])[] = [
  ['\x1b[0c', '\x1b[?6c'], // primary device attributes
  ['\x1b[?u', '\x1b[?0u'], // kitty keyboard flags
  ['\x1b[6n', '\x1b[1;1R'], // cursor position report
  ['\x1b]11;?', '\x1b]11;rgb:0000/0000/0000\x1b\\'], // background colour
  ['\x1bP+q', '\x1bP0+r\x1b\\'] // XTGETTCAP (unsupported)
]

/** Derived, not hardcoded: a shorter carry than the longest query would silently
 *  stop matching sequences split across two PTY chunks. */
const QUERY_CARRY_LEN = Math.max(...TERMINAL_QUERY_REPLIES.map(([query]) => query.length))

describePosix('daemon shell-ready fish launches', () => {
  let previousUserDataPath: string | undefined
  let userDataPath: string

  beforeEach(() => {
    previousUserDataPath = process.env.ORCA_USER_DATA_PATH
    userDataPath = mkdtempSync(join(tmpdir(), 'daemon-fish-shell-ready-'))
    process.env.ORCA_USER_DATA_PATH = userDataPath
  })

  afterEach(() => {
    if (previousUserDataPath === undefined) {
      delete process.env.ORCA_USER_DATA_PATH
    } else {
      process.env.ORCA_USER_DATA_PATH = previousUserDataPath
    }
    rmSync(userDataPath, { recursive: true, force: true })
    vi.restoreAllMocks()
  })

  itWithFish(
    'emits the marker at the first real fish prompt and executes a post-marker command',
    async () => {
      const { getShellReadyLaunchConfig } = await importFreshShellReady()
      const config = getShellReadyLaunchConfig('fish')
      const tempHome = mkdtempSync(join(tmpdir(), 'fish-shell-ready-'))
      const sentinel = join(tempHome, 'launched')
      const erased = join(tempHome, 'marker-erased')
      const stillRegistered = join(tempHome, 'marker-still-registered')
      try {
        mkdirSync(join(tempHome, '.config', 'fish'), { recursive: true })
        // Why: mimic a slow prompt integration (Starship) — init work before the first prompt.
        writeFileSync(
          join(tempHome, '.config', 'fish', 'config.fish'),
          'command sleep 0.2\nfunction fish_prompt\n  printf "> "\nend\n'
        )
        const pty = await import('node-pty')
        const proc = pty.spawn('fish', config.args ?? [], {
          name: 'xterm-256color',
          cols: 80,
          rows: 24,
          cwd: tempHome,
          env: {
            PATH: process.env.PATH ?? '/usr/bin:/bin',
            HOME: tempHome,
            TERM: 'xterm-256color',
            ...config.env
          }
        })
        let output = ''
        let commandWritten = false
        let erasureProbeWritten = false
        let queryCarry = ''
        let settle = (): void => {}
        const done = new Promise<void>((resolve) => {
          settle = resolve
        })
        const deadline = setTimeout(settle, 10_000)
        // Why: settling on the first sentinel observes only one post-marker prompt,
        // so a marker that never erased itself still looks single. Drive a second
        // command and settle on its result, which also probes the erase directly.
        const sentinelPoll = setInterval(() => {
          if (commandWritten && !erasureProbeWritten && existsSync(sentinel)) {
            erasureProbeWritten = true
            proc.write(
              `functions -q __orca_shell_ready_marker; and touch ${stillRegistered}; or touch ${erased}\n`
            )
            return
          }
          if (erasureProbeWritten && (existsSync(erased) || existsSync(stillRegistered))) {
            settle()
          }
        }, 50)
        proc.onData((chunk) => {
          output += chunk
          // Why: fish stalls its first prompt 10s waiting on these and re-queries
          // each prompt, so answer every occurrence — an unanswered query makes
          // fish swallow the post-marker command as its reply.
          const carriedLength = queryCarry.length
          const scan = queryCarry + chunk
          queryCarry = scan.slice(-QUERY_CARRY_LEN)
          for (const [query, reply] of TERMINAL_QUERY_REPLIES) {
            for (
              let at = scan.indexOf(query);
              at !== -1;
              at = scan.indexOf(query, at + query.length)
            ) {
              // Why: a query wholly inside the carry was answered on the previous
              // chunk; replying again would land in fish's stdin as typed input.
              if (at + query.length > carriedLength) {
                proc.write(reply)
              }
            }
          }
          if (!commandWritten && output.includes(SHELL_READY_MARKER_OUTPUT)) {
            commandWritten = true
            // Why: mirror PostReadyFlushGate — flush shortly after the post-marker prompt draw.
            setTimeout(() => proc.write(`touch ${sentinel}\n`), 50)
          }
        })
        await done
        clearTimeout(deadline)
        clearInterval(sentinelPoll)
        proc.kill()

        expect(output).toContain(SHELL_READY_MARKER_OUTPUT)
        expect(output.split(SHELL_READY_MARKER_OUTPUT)).toHaveLength(2)
        expect(existsSync(sentinel)).toBe(true)
        // Why: asserts the erase directly rather than inferring it from the marker
        // count, which only holds once enough prompts have been drawn to expose it.
        expect(existsSync(erased)).toBe(true)
        expect(existsSync(stillRegistered)).toBe(false)
      } finally {
        rmSync(tempHome, { recursive: true, force: true })
      }
    },
    15_000
  )

  itWithFish(
    'wraps prime-agent in a real fish login shell launched from the daemon config',
    async () => {
      const { getShellReadyLaunchConfig } = await importFreshShellReady()
      const config = getShellReadyLaunchConfig('fish')
      const tempHome = mkdtempSync(join(tmpdir(), 'fish-prime-wrapper-'))
      const binDir = join(tempHome, 'bin')
      const extensionPath = join(tempHome, 'orca-agent-status.ts')
      const capturePath = join(tempHome, 'capture')
      try {
        mkdirSync(binDir, { recursive: true })
        writeFileSync(extensionPath, 'export default {}')
        writeFileSync(
          join(binDir, 'prime-agent'),
          `#!/bin/sh\nprintf '%s\\n' "$@" > "$ORCA_CAPTURE_FILE"\n`,
          { mode: 0o755 }
        )
        const pty = await import('node-pty')
        const proc = pty.spawn('fish', config.args ?? [], {
          name: 'xterm-256color',
          cols: 80,
          rows: 24,
          cwd: tempHome,
          env: {
            PATH: `${binDir}:${process.env.PATH ?? '/usr/bin:/bin'}`,
            HOME: tempHome,
            TERM: 'xterm-256color',
            ORCA_PRIME_AGENT_STATUS_EXTENSION: extensionPath,
            ORCA_CAPTURE_FILE: capturePath,
            ...config.env
          }
        })
        let output = ''
        let commandWritten = false
        let queryCarry = ''
        let settle = (): void => {}
        const done = new Promise<void>((resolve) => {
          settle = resolve
        })
        const deadline = setTimeout(settle, 10_000)
        // Why a filesystem marker: the wrapper's whole effect is the argv it
        // hands the real binary, and the terminal buffer only shows fish's
        // wrapped echo of what was typed.
        const capturePoll = setInterval(() => {
          if (existsSync(capturePath)) {
            settle()
          }
        }, 50)
        proc.onData((chunk) => {
          output += chunk
          const carriedLength = queryCarry.length
          const scan = queryCarry + chunk
          queryCarry = scan.slice(-QUERY_CARRY_LEN)
          for (const [query, reply] of TERMINAL_QUERY_REPLIES) {
            for (
              let at = scan.indexOf(query);
              at !== -1;
              at = scan.indexOf(query, at + query.length)
            ) {
              if (at + query.length > carriedLength) {
                proc.write(reply)
              }
            }
          }
          if (!commandWritten && output.includes(SHELL_READY_MARKER_OUTPUT)) {
            commandWritten = true
            setTimeout(() => proc.write('prime-agent ask\n'), 50)
          }
        })
        await done
        clearTimeout(deadline)
        clearInterval(capturePoll)
        proc.kill()

        expect(existsSync(capturePath), output).toBe(true)
        expect(readFileSync(capturePath, 'utf8')).toBe(`--extension\n${extensionPath}\nask\n`)
      } finally {
        rmSync(tempHome, { recursive: true, force: true })
      }
    },
    15_000
  )
})
