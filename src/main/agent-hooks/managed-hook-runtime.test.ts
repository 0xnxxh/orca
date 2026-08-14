import { chmod, mkdir, mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type * as NodeChildProcess from 'node:child_process'

// Why: the probe spawns a real login shell, and `resolveRelayGrokHome` swallows every
// spawn failure into its fallback. Left unmocked this asserts the runner's scheduling
// latency, not the parser: on a loaded sharded CI box the 8s timeout expires and the
// first case silently flips to the fallback path.
vi.mock('node:child_process', async (importOriginal) => {
  const actual = await importOriginal<typeof NodeChildProcess>()
  return { ...actual, execFile: vi.fn() }
})

const { execFile } = await import('node:child_process')
const execFileMock = vi.mocked(execFile)
const { execFile: actualExecFile } =
  await vi.importActual<typeof NodeChildProcess>('node:child_process')
const { installManagedHooks, resolveRelayGrokHome } = await import('./managed-hook-runtime')

type ExecFileCallback = (error: Error | null, result?: { stdout: string; stderr: string }) => void

function stubProbeOutput(stdout: string): void {
  execFileMock.mockImplementation(((...args: unknown[]) => {
    ;(args.at(-1) as ExecFileCallback)(null, { stdout, stderr: '' })
    return undefined
  }) as unknown as typeof execFile)
}

function stubProbeFailure(error: Error): void {
  execFileMock.mockImplementation(((...args: unknown[]) => {
    ;(args.at(-1) as ExecFileCallback)(error)
    return undefined
  }) as unknown as typeof execFile)
}

beforeEach(() => {
  execFileMock.mockReset()
  // Why: `installManagedHooks` proves a skipped probe through the login-shell run log, so the
  // probe must really spawn unless a case above stubs it. The mock loses `promisify.custom`,
  // so the real `(error, stdout, stderr)` callback is reshaped into the `{ stdout, stderr }`
  // that `promisify(execFile)` resolves in production.
  execFileMock.mockImplementation(((...args: unknown[]) => {
    const callback = args.at(-1) as ExecFileCallback
    return (actualExecFile as (...callArgs: unknown[]) => unknown)(
      ...args.slice(0, -1),
      (error: Error | null, stdout: string, stderr: string) => callback(error, { stdout, stderr })
    )
  }) as unknown as typeof execFile)
})

const tempHomes: string[] = []
const tempRoot = process.platform === 'win32' ? tmpdir() : '/tmp'
const SHELL_NAME = 'login-shell'
const SHELL_RUNS_NAME = 'login-shell-runs'

async function createTempHome(): Promise<string> {
  const home = await mkdtemp(join(tempRoot, 'orca-managed-hook-runtime-'))
  tempHomes.push(home)
  return home
}

/** Login shell that records each invocation, so a skipped GROK_HOME probe is observable. */
async function stubLoginShell(home: string): Promise<void> {
  const shell = join(home, SHELL_NAME)
  await writeFile(
    shell,
    `#!/bin/sh\necho ran >> "${join(home, SHELL_RUNS_NAME)}"\nexit 0\n`,
    'utf8'
  )
  await chmod(shell, 0o755)
  vi.stubEnv('HOME', home)
  vi.stubEnv('SHELL', shell)
}

afterEach(async () => {
  vi.unstubAllEnvs()
  await Promise.all(tempHomes.splice(0).map((home) => rm(home, { recursive: true, force: true })))
})

describe.runIf(process.platform !== 'win32')('resolveRelayGrokHome', () => {
  it('uses the login-shell GROK_HOME and normalizes trailing separators', async () => {
    vi.stubEnv('SHELL', '/bin/sh')
    stubProbeOutput('/srv/grok///\n')

    await expect(resolveRelayGrokHome('/home/orca')).resolves.toBe('/srv/grok')

    const [shell, args] = execFileMock.mock.calls[0] ?? []
    expect(shell).toBe('/bin/sh')
    // `sh`/`dash` reject `-lc`, so the mode choice is part of the contract under test.
    expect(args?.[0]).toBe('-c')
  })

  it('passes -lc to a login shell that supports it', async () => {
    vi.stubEnv('SHELL', '/bin/zsh')
    stubProbeOutput('/srv/grok\n')

    await expect(resolveRelayGrokHome('/home/orca')).resolves.toBe('/srv/grok')

    const [shell, args] = execFileMock.mock.calls[0] ?? []
    expect(shell).toBe('/bin/zsh')
    expect(args?.[0]).toBe('-lc')
  })

  it('falls back when the login-shell GROK_HOME is not an absolute POSIX path', async () => {
    vi.stubEnv('SHELL', '/bin/sh')
    stubProbeOutput('../relative\n')

    await expect(resolveRelayGrokHome('/home/orca')).resolves.toBe('/home/orca/.grok')
  })

  // Why: this is the branch that made the old test flaky — pin it so a probe failure is
  // an asserted fallback rather than an invisible substitution for a real answer.
  it('falls back when the probe fails or times out', async () => {
    vi.stubEnv('SHELL', '/bin/sh')
    stubProbeFailure(Object.assign(new Error('spawn timed out'), { killed: true }))

    await expect(resolveRelayGrokHome('/home/orca')).resolves.toBe('/home/orca/.grok')
  })
})

describe.runIf(process.platform !== 'win32')('installManagedHooks', () => {
  it.each([
    ['omitted', undefined, ['.orca', SHELL_NAME, SHELL_RUNS_NAME]],
    ['empty', { agents: [] }, ['.orca', SHELL_NAME]]
  ])(
    'writes nothing and skips the GROK_HOME probe only for an explicit empty allowlist (%s) (issue #11641)',
    async (_label, options, expectedEntries) => {
      const home = await createTempHome()
      await stubLoginShell(home)

      await expect(installManagedHooks(options)).resolves.toEqual({ installers: 0, errors: 0 })

      // Why: no agent config home is written; the install lock always creates ~/.orca,
      // and only an omitted allowlist still probes GROK_HOME through the login shell.
      expect((await readdir(home)).sort()).toEqual(expectedEntries)
    }
  )

  it('strips retired Gemini managed hooks during an empty-allowlist install', async () => {
    const home = await createTempHome()
    await stubLoginShell(home)
    const scriptPath = join(home, '.orca', 'agent-hooks', 'gemini-hook.sh')
    await mkdir(join(home, '.gemini'), { recursive: true })
    await mkdir(join(home, '.orca', 'agent-hooks'), { recursive: true })
    await writeFile(scriptPath, '#!/bin/sh\nprintf "{}\\n"\n', 'utf8')
    const settingsPath = join(home, '.gemini', 'settings.json')
    await writeFile(
      settingsPath,
      JSON.stringify({
        hooks: {
          BeforeAgent: [
            { hooks: [{ type: 'command', command: `/bin/sh '${scriptPath}'` }] },
            { hooks: [{ type: 'command', command: '/usr/local/bin/user-hook' }] }
          ]
        },
        theme: 'dark'
      }),
      'utf8'
    )

    await expect(installManagedHooks({ agents: [] })).resolves.toEqual({
      installers: 0,
      errors: 0
    })

    const settings = JSON.parse(await readFile(settingsPath, 'utf8')) as {
      hooks: { BeforeAgent?: { hooks?: { command?: string }[] }[] }
      theme: string
    }
    expect(settings.theme).toBe('dark')
    expect(settings.hooks.BeforeAgent).toEqual([
      { hooks: [{ type: 'command', command: '/usr/local/bin/user-hook' }] }
    ])
    await expect(readFile(scriptPath, 'utf8')).rejects.toMatchObject({ code: 'ENOENT' })
  })

  it('still rejects an aborted request rather than resolving an empty summary', async () => {
    const controller = new AbortController()
    controller.abort()

    await expect(
      installManagedHooks({ signal: controller.signal, agents: [] })
    ).rejects.toMatchObject({ name: 'AbortError' })
  })

  it('installs only the allowlisted agent, under the install lock', async () => {
    const home = await createTempHome()
    await stubLoginShell(home)

    await expect(installManagedHooks({ agents: ['claude'] })).resolves.toEqual({
      installers: 1,
      errors: 0
    })

    expect((await readdir(home)).sort()).toEqual(['.claude', '.orca', SHELL_NAME, SHELL_RUNS_NAME])
  })
})
