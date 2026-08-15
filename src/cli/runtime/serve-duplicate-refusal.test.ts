import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { SINGLE_INSTANCE_ALREADY_RUNNING_EXIT_CODE } from '../../shared/single-instance-exit-code'

const { spawnMock } = vi.hoisted(() => ({ spawnMock: vi.fn() }))

vi.mock('child_process', () => ({ spawn: spawnMock }))

import { serveOrcaApp } from './launch'

/**
 * Why: on macOS the Electron main aborts inside `_RegisterApplication` before any
 * JS runs whenever Launch Services is unreachable, so the single-instance rule it
 * would have applied never runs and a supervisor retry becomes a SIGABRT loop
 * (STA-4336). These assert the CLI decides *before* the exec.
 */
describe('serveOrcaApp duplicate refusal', () => {
  let userDataPath: string
  let stderrSpy: ReturnType<typeof vi.spyOn>
  let stdoutSpy: ReturnType<typeof vi.spyOn>

  beforeEach(async () => {
    spawnMock.mockReset()
    userDataPath = await mkdtemp(join(tmpdir(), 'orca-serve-duplicate-'))
    process.env.ORCA_USER_DATA_PATH = userDataPath
    process.env.ORCA_APP_EXECUTABLE = '/Applications/Orca.app/Contents/MacOS/Orca'
    stderrSpy = vi.spyOn(process.stderr, 'write').mockImplementation(() => true)
    stdoutSpy = vi.spyOn(process.stdout, 'write').mockImplementation(() => true)
  })

  function writtenJson(spy: ReturnType<typeof vi.spyOn>): unknown {
    const written = spy.mock.calls.map((call) => String(call[0])).join('')
    return JSON.parse(written)
  }

  afterEach(async () => {
    vi.restoreAllMocks()
    delete process.env.ORCA_USER_DATA_PATH
    delete process.env.ORCA_APP_EXECUTABLE
    await rm(userDataPath, { recursive: true, force: true })
  })

  async function writeLiveRuntimeMetadata(): Promise<void> {
    // Why: an unreachable endpoint with a live pid is the exact shape of a serve
    // that is still starting — the window in which duplicates used to be spawned.
    await writeFile(
      join(userDataPath, 'orca-runtime.json'),
      JSON.stringify({
        runtimeId: 'runtime-owner',
        pid: process.pid,
        transport: { kind: 'unix', endpoint: join(userDataPath, 'never-listening.sock') },
        authToken: 'token',
        startedAt: Date.now()
      })
    )
  }

  it('refuses without spawning when the profile already has a live owner', async () => {
    await writeLiveRuntimeMetadata()

    await expect(serveOrcaApp()).resolves.toBe(SINGLE_INSTANCE_ALREADY_RUNNING_EXIT_CODE)
    expect(spawnMock).not.toHaveBeenCalled()
    expect(stderrSpy).toHaveBeenCalledWith(expect.stringContaining('already running'))
  })

  // Why: `--json`/`--recipe-json` callers parse stdout; a prose-only refusal is
  // indistinguishable to them from a serve that produced no output at all.
  it('reports the refusal as a machine-readable envelope for --json', async () => {
    await writeLiveRuntimeMetadata()

    await expect(serveOrcaApp({ json: true })).resolves.toBe(
      SINGLE_INSTANCE_ALREADY_RUNNING_EXIT_CODE
    )
    expect(spawnMock).not.toHaveBeenCalled()
    expect(writtenJson(stdoutSpy)).toMatchObject({
      ok: false,
      error: { code: 'runtime_serve_already_running', data: { pid: process.pid } }
    })
  })

  it('refuses recipe-json runs too', async () => {
    await writeLiveRuntimeMetadata()

    await expect(serveOrcaApp({ recipeJson: true, projectRoot: '/workspace/repo' })).resolves.toBe(
      SINGLE_INSTANCE_ALREADY_RUNNING_EXIT_CODE
    )
    expect(spawnMock).not.toHaveBeenCalled()
    expect(writtenJson(stdoutSpy)).toMatchObject({
      ok: false,
      error: { code: 'runtime_serve_already_running' }
    })
  })

  it('still spawns when no runtime owns the profile', async () => {
    spawnMock.mockReturnValue({ on: vi.fn(), once: vi.fn(), unref: vi.fn(), kill: vi.fn() })

    void serveOrcaApp({ json: true })

    await vi.waitFor(() => expect(spawnMock).toHaveBeenCalledTimes(1))
  })
})
