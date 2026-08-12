/**
 * Real-fish proof that the agent draft-prefill teardown actually clears the variable.
 *
 * `buildAgentDraftLaunchPlan` exports the draft through an env var and appends a
 * teardown to the launch line so the next agent start does not inherit it. fish has
 * no `unset`: the sh spelling errors out and leaves the variable exported, which is
 * only observable in the shell — a string assertion cannot tell the two apart.
 *
 * DA1/CPR/OSC-11 probes are answered here because no real xterm is attached;
 * without them fish stalls ~10s on its DA1 read sentinel before the first prompt.
 */
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { fishRequirementViolation, resolveFishBinary } from './fish-binary-requirement'
import { clearEnvCommand } from './tui-agent-startup-shell'

const FISH = resolveFishBinary(4)
const itWithFish = FISH.available ? it : it.skip

const PROMPT_MARK = 'ORCAENV> '
const VAR = 'ORCA_PI_PREFILL'

const sleep = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms))

async function waitUntil(predicate: () => boolean, timeoutMs: number): Promise<boolean> {
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    if (predicate()) {
      return true
    }
    await sleep(20)
  }
  return false
}

describe('fish clears an agent draft prefill variable', () => {
  let home: string | null = null

  // Always runs, so the CI lane cannot report green with the regression below skipped.
  it('has the fish this suite needs when CI requires one', () => {
    expect(fishRequirementViolation(FISH)).toBeNull()
  })

  afterEach(() => {
    if (home) {
      rmSync(home, { recursive: true, force: true })
      home = null
    }
  })

  itWithFish(
    'clears with the fish teardown and provably fails with the sh one',
    async () => {
      const nodePty = await import('node-pty')

      home = mkdtempSync(path.join(tmpdir(), 'orca-fish-prefill-'))
      mkdirSync(path.join(home, 'fish'), { recursive: true })
      writeFileSync(
        path.join(home, 'fish/config.fish'),
        [
          'set -g fish_greeting ""',
          `function fish_prompt; printf '${PROMPT_MARK}'; end`,
          'function fish_right_prompt; end',
          ''
        ].join('\n')
      )

      const term = nodePty.spawn(FISH.path as string, ['-l', '-i'], {
        name: 'xterm-256color',
        cols: 120,
        rows: 30,
        cwd: home,
        env: {
          PATH: process.env.PATH ?? '/usr/bin:/bin',
          HOME: home,
          TERM: 'xterm-256color',
          LANG: 'en_US.UTF-8',
          XDG_CONFIG_HOME: home,
          XDG_DATA_HOME: path.join(home, 'data'),
          [VAR]: 'draft text'
        }
      })

      let rendered = ''
      term.onData((chunk) => {
        rendered += chunk
        if (chunk.includes('\x1b[0c') || chunk.includes('\x1b[c')) {
          term.write('\x1b[?62;4;6;22c')
        }
        if (chunk.includes('\x1b[6n')) {
          term.write('\x1b[1;1R')
        }
        if (chunk.includes('\x1b]10;?') || chunk.includes('\x1b]11;?')) {
          term.write('\x1b]11;rgb:1e1e/1e1e/1e1e\x1b\\')
        }
      })
      let exited = false
      term.onExit(() => {
        exited = true
      })

      // `set -q` exits 0 while the variable exists, so the echoed status is the verdict.
      const probe = (label: string): Promise<boolean> => {
        term.write(`set -q ${VAR}; echo ${label}=$status\r`)
        return waitUntil(() => new RegExp(`${label}=[01]`).test(rendered), 5_000)
      }
      const statusOf = (label: string): string =>
        new RegExp(`${label}=([01])`).exec(rendered)?.[1] ?? 'missing'

      try {
        expect(await waitUntil(() => rendered.includes(PROMPT_MARK), 15_000)).toBe(true)
        expect(await probe('BEFORE')).toBe(true)
        expect(statusOf('BEFORE')).toBe('0')

        // The sh spelling Orca emitted before this dialect was threaded through.
        term.write(`${clearEnvCommand(VAR, 'posix')}\r`)
        expect(await probe('AFTERSH')).toBe(true)
        expect(rendered).toContain('Unknown command')
        expect(statusOf('AFTERSH')).toBe('0')

        term.write(`${clearEnvCommand(VAR, 'fish')}\r`)
        expect(await probe('AFTERFISH')).toBe(true)
        expect(statusOf('AFTERFISH')).toBe('1')
      } finally {
        term.write('exit\r')
        await waitUntil(() => exited, 5_000)
        try {
          term.kill()
        } catch {
          // already gone
        }
      }
    },
    40_000
  )
})
