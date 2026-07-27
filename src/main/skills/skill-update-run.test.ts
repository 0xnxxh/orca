import { EventEmitter } from 'node:events'
import { describe, expect, it, vi } from 'vitest'
import type { SkillUpdateRun } from '../../shared/skill-freshness'
import { SkillUpdateRunner } from './skill-update-run'

class FakeChild extends EventEmitter {
  stdout = new EventEmitter()
  stderr = new EventEmitter()
  kill = vi.fn()
}

function makeRunner(
  overrides: {
    rescanOutdatedNames?: (names: string[]) => Promise<string[]>
    resolveCommand?: (name: string) => string
  } = {}
) {
  const child = new FakeChild()
  const spawnCalls: { command: string; args: string[]; options: Record<string, unknown> }[] = []
  const states: SkillUpdateRun[] = []
  const runner = new SkillUpdateRunner({
    now: () => 1000,
    resolveCommand: overrides.resolveCommand ?? (() => '/usr/local/bin/npx'),
    rescanOutdatedNames: overrides.rescanOutdatedNames,
    onState: (run) => states.push(run),
    spawnProcess: ((command: string, args: string[], options: Record<string, unknown>) => {
      spawnCalls.push({ command, args, options })
      return child as never
    }) as never
  })
  return { runner, child, spawnCalls, states }
}

async function flush(): Promise<void> {
  await new Promise((resolve) => setImmediate(resolve))
}

describe('SkillUpdateRunner', () => {
  it('passes both non-interactive flags and the sorted skill names', () => {
    const { runner, spawnCalls } = makeRunner()

    expect(runner.start(['orchestration', 'orca-cli'])).toEqual({ started: true })
    expect(spawnCalls[0].command).toBe('/usr/local/bin/npx')
    // `npx --yes` skips the install prompt; `skills -y` takes the CLI's own
    // non-interactive branch. Dropping either can wedge the run.
    expect(spawnCalls[0].args).toEqual([
      '--yes',
      'skills',
      'update',
      'orca-cli',
      'orchestration',
      '--global',
      '-y'
    ])
  })

  it('ignores stdin so the CLI sees a non-TTY', () => {
    const { runner, spawnCalls } = makeRunner()
    runner.start(['orca-cli'])

    expect(spawnCalls[0].options.stdio).toEqual(['ignore', 'pipe', 'pipe'])
  })

  it('rejects names that could carry shell syntax', () => {
    const { runner, spawnCalls } = makeRunner()

    expect(runner.start(['orca-cli; rm -rf /'])).toEqual({
      started: false,
      reason: 'invalid-names'
    })
    expect(spawnCalls).toHaveLength(0)
  })

  it('refuses a second concurrent run', () => {
    const { runner } = makeRunner()
    runner.start(['orca-cli'])

    expect(runner.start(['orchestration'])).toEqual({ started: false, reason: 'already-running' })
  })

  it('strips ANSI colour and carriage returns from captured output', async () => {
    const { runner, child } = makeRunner({ rescanOutdatedNames: async () => [] })
    runner.start(['orca-cli'])
    child.stdout.emit('data', Buffer.from('\x1b[36mChecking\x1b[0m\rUpdating orca-cli…'))
    child.emit('close', 0)
    await flush()

    const run = runner.getState()
    expect(run.state).toBe('success')
    expect(run.state === 'success' && run.output).toBe('Checking\nUpdating orca-cli…')
  })

  it('treats a clean re-scan as success even though the exit code is non-zero', async () => {
    // A peer skill outside our request can fail the process; what we asked for landed.
    const { runner, child } = makeRunner({ rescanOutdatedNames: async () => [] })
    runner.start(['orca-cli'])
    child.emit('close', 1)
    await flush()

    expect(runner.getState().state).toBe('success')
  })

  it('attributes failure to the names the re-scan says are still outdated', async () => {
    const { runner, child } = makeRunner({
      rescanOutdatedNames: async () => ['orchestration']
    })
    runner.start(['orca-cli', 'orchestration'])
    child.emit('close', 1)
    await flush()

    const run = runner.getState()
    expect(run.state).toBe('error')
    expect(run.state === 'error' && run.failedNames).toEqual(['orchestration'])
  })

  it('fails every requested name when the re-scan itself throws', async () => {
    const { runner, child } = makeRunner({
      rescanOutdatedNames: async () => {
        throw new Error('scan blew up')
      }
    })
    runner.start(['orca-cli'])
    child.emit('error', new Error('spawn ENOENT'))
    await flush()

    const run = runner.getState()
    expect(run.state).toBe('error')
    expect(run.state === 'error' && run.failedNames).toEqual(['orca-cli'])
    expect(run.state === 'error' && run.message).toBe('spawn ENOENT')
  })

  it('returns to idle on cancel and stops reporting output', async () => {
    const { runner, child, states } = makeRunner({ rescanOutdatedNames: async () => [] })
    runner.start(['orca-cli'])
    runner.cancel()
    child.stdout.emit('data', Buffer.from('late output'))
    await flush()

    expect(child.kill).toHaveBeenCalled()
    expect(runner.getState()).toEqual({ state: 'idle' })
    expect(states.at(-1)).toEqual({ state: 'idle' })
  })

  it('acknowledge clears a settled run but leaves a live one alone', async () => {
    const { runner, child } = makeRunner({ rescanOutdatedNames: async () => [] })
    runner.start(['orca-cli'])
    runner.acknowledge()
    expect(runner.getState().state).toBe('running')

    child.emit('close', 0)
    await flush()
    runner.acknowledge()
    expect(runner.getState()).toEqual({ state: 'idle' })
  })
})
