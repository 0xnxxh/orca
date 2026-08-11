/**
 * Executes the WSL guest login script's fish branch against a real fish.
 *
 * Why run the script rather than assert its text: a string assertion cannot
 * catch a fish parse error in the wrapper it sources, and the STA-3927 failure
 * mode is precisely "fish started fine but prime-agent went unwrapped".
 *
 * What this does NOT exercise: wsl.exe itself, WSLENV `/p` path translation, or
 * /mnt/c access from a guest. This is a POSIX host standing in for the distro.
 */
import { spawnSync } from 'node:child_process'
import {
  chmodSync,
  closeSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  openSync,
  readFileSync,
  rmSync,
  writeFileSync
} from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { buildWslInteractiveLoginShellCommand } from '../../shared/wsl-login-shell-command'
import { resolveWindowsShellLaunchArgs } from './windows-shell-args'

const describePosix = process.platform === 'win32' ? describe.skip : describe

// Why an absolute path: the guest script only accepts a login shell that passes
// `[ -x ]`, so a bare `fish` would fall through to /bin/sh and make every
// assertion below pass for the wrong reason.
const fishPath = (() => {
  if (process.platform === 'win32') {
    return null
  }
  const which = spawnSync('sh', ['-c', 'command -v fish'], { encoding: 'utf8' })
  const resolved = which.status === 0 ? which.stdout.trim() : ''
  return resolved && existsSync(resolved) ? resolved : null
})()
const itWithFish = fishPath ? it : it.skip

type GuestFixture = {
  home: string
  binDir: string
  extensionPath: string
  capturePath: string
}

/** Why shadow `getent`: the script reads the login shell from the passwd entry
 *  and only falls back to $SHELL when getent is missing or fails. On macOS there
 *  is no getent so the fallback fires, but on Linux — every CI runner — getent
 *  returns the account's real shell (bash), the case dispatches to `bash)`, and
 *  the fish branch is never entered while the assertions still pass off the bash
 *  wrapper. Pinning the passwd answer makes the branch deterministic on both. */
function makeGuestFixture(loginShell: string): GuestFixture {
  const home = mkdtempSync(join(tmpdir(), 'wsl-fish-guest-'))
  const binDir = join(home, 'bin')
  const extensionPath = join(home, 'orca-agent-status.ts')
  const capturePath = join(home, 'capture')
  mkdirSync(binDir)
  writeFileSync(extensionPath, 'export default {}')
  writeFileSync(
    join(binDir, 'prime-agent'),
    `#!/bin/sh\nprintf '%s\\n' "$@" > "$ORCA_CAPTURE_FILE"\n`,
    {
      mode: 0o755
    }
  )
  chmodSync(join(binDir, 'prime-agent'), 0o755)
  writeFileSync(
    join(binDir, 'getent'),
    `#!/bin/sh\nprintf 'guest:x:1000:1000::%s:%s\\n' "$HOME" "${loginShell}"\n`,
    { mode: 0o755 }
  )
  chmodSync(join(binDir, 'getent'), 0o755)
  // Why a .profile: a POSIX login shell sources /etc/profile, which on most
  // distros *overwrites* PATH and would hide the fake prime-agent from the
  // non-fish control below. fish never reads /etc/profile, so only the control
  // needs it — but a guest user's profile owning PATH is the realistic shape.
  writeFileSync(join(home, '.profile'), `PATH="${binDir}:$PATH"\nexport PATH\n`)
  writeFileSync(join(home, 'stdin-script'), 'prime-agent ask\n')
  return { home, binDir, extensionPath, capturePath }
}

function runGuestLogin(
  fixture: GuestFixture,
  env: NodeJS.ProcessEnv
): { stderr: string; stdout: string } {
  // Why stdin from a real file rather than spawnSync's `input`: the script
  // execs a login shell with no `-c`, so the command has to arrive on stdin —
  // and fish fstats fd 0, where Node's `input` pipe reports EISDIR and fish
  // dies with "Unable to read input file: Is a directory" before running
  // anything. Reproduced on fish 3.6/3.7 (Linux); macOS fish 4.8 tolerates the
  // pipe, which is exactly how this passed locally and failed in CI. A regular
  // file fstats cleanly on both.
  const stdin = openSync(join(fixture.home, 'stdin-script'), 'r')
  try {
    const result = spawnSync('sh', ['-c', buildWslInteractiveLoginShellCommand()], {
      cwd: fixture.home,
      stdio: [stdin, 'pipe', 'pipe'],
      env: {
        PATH: `${fixture.binDir}:${process.env.PATH ?? ''}`,
        HOME: fixture.home,
        ORCA_CAPTURE_FILE: fixture.capturePath,
        ...env
      },
      encoding: 'utf8',
      timeout: 15_000
    })
    return { stderr: result.stderr ?? '', stdout: result.stdout ?? '' }
  } finally {
    closeSync(stdin)
  }
}

describePosix('WSL guest login script, fish branch', () => {
  let previousUserDataPath: string | undefined
  let userDataPath: string
  const guestHomes: string[] = []

  beforeEach(() => {
    previousUserDataPath = process.env.ORCA_USER_DATA_PATH
    userDataPath = mkdtempSync(join(tmpdir(), 'wsl-fish-userdata-'))
    process.env.ORCA_USER_DATA_PATH = userDataPath
  })

  afterEach(() => {
    if (previousUserDataPath === undefined) {
      delete process.env.ORCA_USER_DATA_PATH
    } else {
      process.env.ORCA_USER_DATA_PATH = previousUserDataPath
    }
    rmSync(userDataPath, { recursive: true, force: true })
    for (const home of guestHomes.splice(0)) {
      rmSync(home, { recursive: true, force: true })
    }
  })

  itWithFish(
    'wraps prime-agent when the guest login shell is fish',
    () => {
      // Why through the real entry point: this is what materializes the wrapper
      // files the guest script then sources.
      resolveWindowsShellLaunchArgs('wsl.exe', 'C:\\Users\\alice\\code', 'C:\\Users\\alice')

      const fixture = makeGuestFixture(fishPath ?? 'fish')
      guestHomes.push(fixture.home)
      const result = runGuestLogin(fixture, {
        ORCA_USER_DATA_PATH: userDataPath,
        ORCA_PRIME_AGENT_STATUS_EXTENSION: fixture.extensionPath
      })

      expect(result.stderr).not.toContain('source:')
      // Why a filesystem marker: the wrapper's effect is the argv handed to the
      // real binary, which the terminal buffer only shows mangled by fish's echo.
      expect(existsSync(fixture.capturePath), result.stderr).toBe(true)
      expect(readFileSync(fixture.capturePath, 'utf8')).toBe(
        `--extension\n${fixture.extensionPath}\nask\n`
      )
    },
    15_000
  )

  itWithFish(
    'reaches a usable fish login when the wrapper file is missing',
    () => {
      const fixture = makeGuestFixture(fishPath ?? 'fish')
      guestHomes.push(fixture.home)
      // Why no wrapper root: a failed wrapper write must fall through to the
      // shared bare login exec rather than erroring on `source`.
      const result = runGuestLogin(fixture, {
        ORCA_PRIME_AGENT_STATUS_EXTENSION: fixture.extensionPath
      })

      expect(result.stderr).not.toContain('source:')
      expect(existsSync(fixture.capturePath), result.stderr).toBe(true)
      expect(readFileSync(fixture.capturePath, 'utf8')).toBe('ask\n')
    },
    15_000
  )

  // Why this control: without it the two cases above could both be passing off
  // whatever shell the host happens to resolve. Same wrapper root, same fixture,
  // only the pinned login shell differs — /bin/sh has no arm in the case, so it
  // must reach the bare login exec and leave prime-agent unwrapped. A getent
  // shadow that did not actually steer the branch would fail here.
  it('leaves a non-fish, non-bash guest login unwrapped with the same wrapper root', () => {
    resolveWindowsShellLaunchArgs('wsl.exe', 'C:\\Users\\alice\\code', 'C:\\Users\\alice')
    expect(existsSync(join(userDataPath, 'shell-ready', 'fish', 'orca.fish'))).toBe(true)

    const fixture = makeGuestFixture('/bin/sh')
    guestHomes.push(fixture.home)
    const result = runGuestLogin(fixture, {
      ORCA_USER_DATA_PATH: userDataPath,
      ORCA_PRIME_AGENT_STATUS_EXTENSION: fixture.extensionPath
    })

    expect(existsSync(fixture.capturePath), result.stderr).toBe(true)
    expect(readFileSync(fixture.capturePath, 'utf8')).toBe('ask\n')
  }, 15_000)
})
