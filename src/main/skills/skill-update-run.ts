import { spawn, type ChildProcess } from 'node:child_process'
import {
  canonicalizeSkillUpdateNames,
  type SkillUpdateRun,
  type SkillUpdateStartResult
} from '../../shared/skill-freshness'
import { resolveCliCommand } from '../codex-cli/command'
import { getSpawnArgsForWindows } from '../win32-utils'

// Why: `skills update` prints ANSI colour and \r + erase-line progress. We show
// this log verbatim to the user but never parse it — `update` has no --json
// (that flag exists only on `list`), so stdout is not a contract.
const ANSI_RE = /\x1b\[[0-9;?]*[A-Za-z]/g // eslint-disable-line no-control-regex

// Keep the tail: failures land at the end, and an unbounded buffer would pin
// however much the CLI decides to print.
const MAX_OUTPUT_CHARS = 32_000

export type SkillUpdateRunnerDeps = {
  spawnProcess?: typeof spawn
  resolveCommand?: (commandName: string) => string
  /** Returns the subset of `names` still outdated after the run. */
  rescanOutdatedNames?: (names: string[]) => Promise<string[]>
  now?: () => number
  onState?: (run: SkillUpdateRun) => void
}

function stripAnsi(value: string): string {
  return value.replace(ANSI_RE, '').replace(/\r(?!\n)/g, '\n')
}

function clampOutput(value: string): string {
  return value.length <= MAX_OUTPUT_CHARS ? value : value.slice(value.length - MAX_OUTPUT_CHARS)
}

/**
 * Runs `npx --yes skills update <names> --global -y` headlessly.
 *
 * Both `--yes` flags are load-bearing and distinct: `npx --yes` skips the
 * install-this-package prompt, and `skills … -y` takes the CLI's own
 * non-interactive branch. `skills` gates its prompts on
 * `options.yes || !process.stdin.isTTY`, and stdin is ignored below, so the run
 * cannot block on input that no one can answer.
 */
export class SkillUpdateRunner {
  private run: SkillUpdateRun = { state: 'idle' }
  private child: ChildProcess | null = null
  private readonly deps: Required<Pick<SkillUpdateRunnerDeps, 'now'>> & SkillUpdateRunnerDeps

  constructor(deps: SkillUpdateRunnerDeps = {}) {
    this.deps = { now: () => Date.now(), ...deps }
  }

  getState(): SkillUpdateRun {
    return this.run
  }

  private publish(next: SkillUpdateRun): void {
    this.run = next
    this.deps.onState?.(next)
  }

  start(names: readonly string[]): SkillUpdateStartResult {
    if (this.run.state === 'running') {
      return { started: false, reason: 'already-running' }
    }
    const canonicalNames = canonicalizeSkillUpdateNames(names)
    if (!canonicalNames) {
      return { started: false, reason: 'invalid-names' }
    }

    const resolveCommand = this.deps.resolveCommand ?? ((name: string) => resolveCliCommand(name))
    const spawnProcess = this.deps.spawnProcess ?? spawn
    const npxCommand = resolveCommand('npx')
    const npxArgs = ['--yes', 'skills', 'update', ...canonicalNames, '--global', '-y']

    let spawnCmd: string
    let spawnArgs: string[]
    try {
      ;({ spawnCmd, spawnArgs } = getSpawnArgsForWindows(npxCommand, npxArgs))
    } catch {
      return { started: false, reason: 'invalid-names' }
    }

    const startedAt = this.deps.now()
    this.publish({ state: 'running', names: canonicalNames, startedAt, output: '' })

    const child = spawnProcess(spawnCmd, spawnArgs, {
      // Why: stdin ignored keeps `process.stdin.isTTY` falsy in the child, which
      // is the second half of the CLI's non-interactive gate.
      stdio: ['ignore', 'pipe', 'pipe'],
      windowsHide: true,
      env: process.env
    })
    this.child = child

    const append = (chunk: Buffer): void => {
      if (this.run.state !== 'running') {
        return
      }
      this.publish({
        ...this.run,
        output: clampOutput(this.run.output + stripAnsi(chunk.toString('utf8')))
      })
    }
    child.stdout?.on('data', append)
    child.stderr?.on('data', append)

    child.on('error', (error) => {
      this.settle(canonicalNames, error.message)
    })
    child.on('close', (code) => {
      this.settle(canonicalNames, code === 0 ? null : `skills update exited with code ${code}`)
    })

    return { started: true }
  }

  private settle(names: string[], spawnError: string | null): void {
    if (this.run.state !== 'running') {
      return
    }
    this.child = null
    const output = this.run.output
    const finishedAt = this.deps.now()
    const rescan = this.deps.rescanOutdatedNames

    // Why: when the re-scan produces a verdict it *is* the answer — it re-hashes
    // what landed on disk, which is what the user actually cares about. The exit
    // code only decides the outcome when no verdict is available, because
    // `skills update` reports nothing else we can trust.
    const finish = (failedNames: string[] | null): void => {
      const failed = failedNames ?? (spawnError ? names : [])
      if (failed.length === 0) {
        this.publish({ state: 'success', names, finishedAt, output })
        return
      }
      this.publish({
        state: 'error',
        names,
        finishedAt,
        output,
        failedNames: failed,
        message: spawnError ?? 'Some skills could not be updated.'
      })
    }

    if (!rescan) {
      finish(null)
      return
    }
    void rescan(names).then(
      (failedNames) => finish(failedNames),
      () => finish(null)
    )
  }

  cancel(): void {
    this.child?.kill()
    this.child = null
    if (this.run.state === 'running') {
      this.publish({ state: 'idle' })
    }
  }

  /** Clears a settled run so the status-bar segment can retire itself. */
  acknowledge(): void {
    if (this.run.state === 'success' || this.run.state === 'error') {
      this.publish({ state: 'idle' })
    }
  }
}
