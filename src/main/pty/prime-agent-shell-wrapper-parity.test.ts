/**
 * Cross-shell parity for the Prime Agent status wrapper.
 *
 * Why a parity suite rather than more per-shell cases: the STA-3927 failure was
 * not a broken wrapper, it was a *missing* one — fish launched cleanly and
 * silently handed `prime-agent` the user's bare argv while bash injected
 * `--extension`. Only a side-by-side capture of the two product launch configs
 * makes that class of gap fail a test. Adapted from the independent repro's
 * real-shell oracle, whose fish assertion was the inverse of the one here.
 */
import { spawnSync } from 'node:child_process'
import {
  chmodSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync
} from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const describePosix = process.platform === 'win32' ? describe.skip : describe
const hasBash = process.platform !== 'win32' && spawnSync('bash', ['--version']).status === 0
const hasFish = process.platform !== 'win32' && spawnSync('fish', ['--version']).status === 0
const itWithBothShells = hasBash && hasFish ? it : it.skip

type CaptureFixture = {
  root: string
  binDir: string
  extensionPath: string
  capturePath: string
}

function makeCaptureFixture(): CaptureFixture {
  const root = mkdtempSync(join(tmpdir(), 'prime-parity-'))
  const binDir = join(root, 'bin')
  const extensionPath = join(root, 'orca-agent-status.ts')
  const capturePath = join(root, 'prime-argv.capture')
  mkdirSync(binDir)
  writeFileSync(extensionPath, 'export default {}')
  // Why a filesystem capture: the wrapper's whole effect is the argv handed to
  // the real binary; the terminal buffer only ever shows the shell's own echo.
  writeFileSync(
    join(binDir, 'prime-agent'),
    `#!/bin/sh
{
  printf 'BEGIN\\n'
  for arg in "$@"; do
    printf 'ARG=%s\\n' "$arg"
  done
  printf 'END\\n'
} >> "$ORCA_CAPTURE_FILE"
`,
    { mode: 0o755 }
  )
  chmodSync(join(binDir, 'prime-agent'), 0o755)
  return { root, binDir, extensionPath, capturePath }
}

function captureEnv(fixture: CaptureFixture): NodeJS.ProcessEnv {
  return {
    ...process.env,
    HOME: fixture.root,
    PATH: `${fixture.binDir}:${process.env.PATH ?? ''}`,
    ORCA_PRIME_AGENT_STATUS_EXTENSION: fixture.extensionPath,
    ORCA_CAPTURE_FILE: fixture.capturePath,
    TERM: 'dumb',
    PS1: '$ '
  }
}

describePosix('Prime Agent wrapper parity across product launch configs', () => {
  let previousUserDataPath: string | undefined
  let userDataPath: string
  const tempDirs: string[] = []

  beforeEach(() => {
    previousUserDataPath = process.env.ORCA_USER_DATA_PATH
    userDataPath = mkdtempSync(join(tmpdir(), 'prime-parity-userdata-'))
    tempDirs.push(userDataPath)
    process.env.ORCA_USER_DATA_PATH = userDataPath
  })

  afterEach(() => {
    if (previousUserDataPath === undefined) {
      delete process.env.ORCA_USER_DATA_PATH
    } else {
      process.env.ORCA_USER_DATA_PATH = previousUserDataPath
    }
    for (const dir of tempDirs.splice(0)) {
      rmSync(dir, { recursive: true, force: true })
    }
    vi.restoreAllMocks()
  })

  itWithBothShells('gives fish the same prime-agent argv the bash wrapper produces', async () => {
    vi.resetModules()
    const { getShellReadyLaunchConfig } = await import('../providers/local-pty-shell-ready')

    const bashConfig = getShellReadyLaunchConfig('/bin/bash')
    const bashFixture = makeCaptureFixture()
    tempDirs.push(bashFixture.root)
    const rcfile = bashConfig.args?.[1] ?? ''
    expect(existsSync(rcfile)).toBe(true)
    const bashRun = spawnSync(
      'bash',
      ['--noprofile', '--rcfile', rcfile, '-ic', 'prime-agent ask'],
      {
        cwd: bashFixture.root,
        env: { ...captureEnv(bashFixture), ...bashConfig.env },
        encoding: 'utf8',
        timeout: 15_000
      }
    )
    expect(bashRun.status, bashRun.stderr).toBe(0)

    const fishConfig = getShellReadyLaunchConfig('/opt/homebrew/bin/fish')
    const fishFixture = makeCaptureFixture()
    tempDirs.push(fishFixture.root)
    // Why the product args verbatim: the gap was in what Orca passes to fish,
    // so a hand-built argv here would test nothing that ships.
    const fishRun = spawnSync('fish', [...(fishConfig.args ?? []), '-c', 'prime-agent ask'], {
      cwd: fishFixture.root,
      env: { ...captureEnv(fishFixture), ...fishConfig.env },
      encoding: 'utf8',
      timeout: 15_000
    })
    expect(fishRun.status, fishRun.stderr).toBe(0)

    const expected = `BEGIN\nARG=--extension\nARG=${'{EXT}'}\nARG=ask\nEND\n`
    expect(readFileSync(bashFixture.capturePath, 'utf8')).toBe(
      expected.replace('{EXT}', bashFixture.extensionPath)
    )
    // The STA-3927 regression: this capture was `BEGIN/ARG=ask/END` — fish ran
    // the user's bare argv and Orca's Prime status reporting never armed.
    expect(readFileSync(fishFixture.capturePath, 'utf8')).toBe(
      expected.replace('{EXT}', fishFixture.extensionPath)
    )
  })

  itWithBothShells('keeps management subcommands unwrapped in both shells', async () => {
    vi.resetModules()
    const { getShellReadyLaunchConfig } = await import('../providers/local-pty-shell-ready')

    const bashConfig = getShellReadyLaunchConfig('/bin/bash')
    const bashFixture = makeCaptureFixture()
    tempDirs.push(bashFixture.root)
    spawnSync(
      'bash',
      ['--noprofile', '--rcfile', bashConfig.args?.[1] ?? '', '-ic', 'prime-agent stop'],
      {
        cwd: bashFixture.root,
        env: { ...captureEnv(bashFixture), ...bashConfig.env },
        encoding: 'utf8',
        timeout: 15_000
      }
    )

    const fishConfig = getShellReadyLaunchConfig('/opt/homebrew/bin/fish')
    const fishFixture = makeCaptureFixture()
    tempDirs.push(fishFixture.root)
    spawnSync('fish', [...(fishConfig.args ?? []), '-c', 'prime-agent stop'], {
      cwd: fishFixture.root,
      env: { ...captureEnv(fishFixture), ...fishConfig.env },
      encoding: 'utf8',
      timeout: 15_000
    })

    expect(readFileSync(bashFixture.capturePath, 'utf8')).toBe('BEGIN\nARG=stop\nEND\n')
    expect(readFileSync(fishFixture.capturePath, 'utf8')).toBe('BEGIN\nARG=stop\nEND\n')
  })
})
