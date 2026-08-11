import { spawnSync } from 'node:child_process'
import { chmodSync, mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { getFishPrimeAgentShellWrapper } from './prime-agent-fish-shell-wrapper'

const describePosix = process.platform === 'win32' ? describe.skip : describe
const hasFish = process.platform !== 'win32' && spawnSync('fish', ['--version']).status === 0
const itWithFish = hasFish ? it : it.skip
const tempDirs: string[] = []

function makeFixture(): {
  root: string
  extensionPath: string
  capturePath: string
  endpointPath: string
  primeHome: string
  wrapper: string
} {
  const root = mkdtempSync(join(tmpdir(), 'orca-prime-fish-wrapper-'))
  tempDirs.push(root)
  const binDir = join(root, 'bin')
  const primeHome = join(root, 'guest-prime-home')
  const extensionPath = join(root, 'orca-agent-status.ts')
  const capturePath = join(root, 'capture')
  const endpointPath = join(
    root,
    '.orca-wsl',
    'agent-hooks',
    'instance-testinstance',
    'endpoint.env'
  )
  const wrapper = join(root, 'orca.fish')
  mkdirSync(binDir)
  mkdirSync(primeHome)
  mkdirSync(dirname(endpointPath), { recursive: true })
  writeFileSync(extensionPath, 'export default {}')
  writeFileSync(endpointPath, 'ORCA_AGENT_HOOK_PORT=4567\nORCA_AGENT_HOOK_TOKEN=current-token\n')
  writeFileSync(wrapper, getFishPrimeAgentShellWrapper())
  writeFileSync(
    join(binDir, 'prime-agent'),
    `#!/bin/sh
{
  printf 'HOME=%s\n' "$PRIME_AGENT_CODING_AGENT_DIR"
  printf 'ENDPOINT=%s\n' "$ORCA_AGENT_HOOK_ENDPOINT"
  i=0
  for arg in "$@"; do
    i=$((i + 1))
    printf 'ARG%s=%s\n' "$i" "$arg"
  done
} > "$ORCA_CAPTURE_FILE"
if [ "\${1:-}" = "config" ]; then
  printf 'preserved\n' > "$PRIME_AGENT_CODING_AGENT_DIR/config.yml"
fi
`,
    { mode: 0o755 }
  )
  chmodSync(join(binDir, 'prime-agent'), 0o755)
  return { root, extensionPath, capturePath, endpointPath, primeHome, wrapper }
}

function runPrime(
  fixture: ReturnType<typeof makeFixture>,
  command: string,
  extensionPath = fixture.extensionPath
): string {
  // Why --no-config: the runner's own ~/.config/fish must not define prime-agent
  // or reorder PATH, which would make the wrapper assertions non-hermetic.
  const result = spawnSync(
    'fish',
    ['--no-config', '-C', `source ${fixture.wrapper}`, '-c', command],
    {
      cwd: fixture.root,
      env: {
        ...process.env,
        HOME: fixture.root,
        PATH: `${join(fixture.root, 'bin')}:${process.env.PATH ?? ''}`,
        PRIME_AGENT_CODING_AGENT_DIR: fixture.primeHome,
        ORCA_PRIME_AGENT_STATUS_EXTENSION: extensionPath,
        ORCA_WSL_HOOK_INSTANCE: 'testinstance',
        ORCA_AGENT_HOOK_ENDPOINT: '/mnt/c/current/endpoint.cmd',
        ORCA_AGENT_HOOK_PORT: '4567',
        ORCA_AGENT_HOOK_TOKEN: 'current-token',
        ORCA_CAPTURE_FILE: fixture.capturePath
      },
      encoding: 'utf8'
    }
  )
  expect(result.status, result.stderr).toBe(0)
  return readFileSync(fixture.capturePath, 'utf8')
}

describePosix('Prime Agent fish shell wrapper', () => {
  afterEach(() => {
    for (const dir of tempDirs.splice(0)) {
      rmSync(dir, { recursive: true, force: true })
    }
  })

  itWithFish('injects the managed extension into an interactive launch', () => {
    const fixture = makeFixture()
    const capture = runPrime(fixture, 'prime-agent ask')

    expect(capture).toContain(`HOME=${fixture.primeHome}`)
    expect(capture).toContain(`ENDPOINT=${fixture.endpointPath}`)
    expect(capture).toContain('ARG1=--extension')
    expect(capture).toContain(`ARG2=${fixture.extensionPath}`)
    expect(capture).toContain('ARG3=ask')
  })

  itWithFish('preserves config subcommands and the guest Prime home', () => {
    const fixture = makeFixture()
    const capture = runPrime(fixture, 'prime-agent config')

    expect(capture).toContain(`HOME=${fixture.primeHome}`)
    expect(capture).toContain('ARG1=config')
    expect(capture).not.toContain('ARG1=--extension')
    expect(readFileSync(join(fixture.primeHome, 'config.yml'), 'utf8')).toBe('preserved\n')
  })

  itWithFish.each([
    'agents',
    'doctor',
    'help',
    'list',
    'model',
    'package',
    'rename',
    'schedule',
    'send',
    'session',
    'shutdown',
    'status',
    'stop',
    'update'
  ])('preserves the %s subcommand argv', (subcommand) => {
    const fixture = makeFixture()
    const capture = runPrime(fixture, `prime-agent ${subcommand}`)

    expect(capture).toContain(`ARG1=${subcommand}`)
    expect(capture).not.toContain('ARG1=--extension')
  })

  itWithFish.each(['stop', 'rename'])(
    'preserves --daemon-socket before the %s management command',
    (subcommand) => {
      const fixture = makeFixture()
      const capture = runPrime(
        fixture,
        `prime-agent --daemon-socket /tmp/prime.sock ${subcommand} agent-123`
      )

      expect(capture).toContain('ARG1=--daemon-socket')
      expect(capture).toContain('ARG2=/tmp/prime.sock')
      expect(capture).toContain(`ARG3=${subcommand}`)
      expect(capture).not.toContain(fixture.extensionPath)
    }
  )

  itWithFish.each(['stop', 'rename'])(
    'preserves --daemon-socket=<path> before the %s management command',
    (subcommand) => {
      const fixture = makeFixture()
      const capture = runPrime(
        fixture,
        `prime-agent --daemon-socket=/tmp/prime.sock ${subcommand} agent-123`
      )

      expect(capture).toContain('ARG1=--daemon-socket=/tmp/prime.sock')
      expect(capture).toContain(`ARG2=${subcommand}`)
      expect(capture).not.toContain(fixture.extensionPath)
    }
  )

  itWithFish('injects the extension after the attach agent operand', () => {
    const fixture = makeFixture()
    const capture = runPrime(fixture, 'prime-agent attach agent-123 --follow')

    expect(capture).toContain('ARG1=attach')
    expect(capture).toContain('ARG2=agent-123')
    expect(capture).toContain('ARG3=--extension')
    expect(capture).toContain(`ARG4=${fixture.extensionPath}`)
    expect(capture).toContain('ARG5=--follow')
  })

  itWithFish('preserves a bare attach without inventing an agent operand', () => {
    const fixture = makeFixture()
    const capture = runPrime(fixture, 'prime-agent attach')

    expect(capture).toContain('ARG1=attach')
    expect(capture).not.toContain('ARG2=')
    expect(capture).not.toContain(fixture.extensionPath)
  })

  itWithFish('preserves attach help without inventing an agent operand', () => {
    const fixture = makeFixture()
    const capture = runPrime(fixture, 'prime-agent attach --help')

    expect(capture).toContain('ARG1=attach')
    expect(capture).toContain('ARG2=--help')
    expect(capture).not.toContain(fixture.extensionPath)
  })

  itWithFish('does not override an explicit user extension', () => {
    const fixture = makeFixture()
    const capture = runPrime(fixture, 'prime-agent --extension /tmp/user-extension.ts ask')

    expect(capture).toContain('ARG1=--extension')
    expect(capture).toContain('ARG2=/tmp/user-extension.ts')
    expect(capture).not.toContain(fixture.extensionPath)
  })

  itWithFish('does not override an explicit --extension= form', () => {
    const fixture = makeFixture()
    const capture = runPrime(fixture, 'prime-agent --extension=/tmp/user-extension.ts ask')

    expect(capture).toContain('ARG1=--extension=/tmp/user-extension.ts')
    expect(capture).not.toContain(fixture.extensionPath)
  })

  itWithFish('does not add a second extension to attach', () => {
    const fixture = makeFixture()
    const capture = runPrime(
      fixture,
      'prime-agent attach agent-123 --extension /tmp/user-extension.ts'
    )

    expect(capture).toContain('ARG1=attach')
    expect(capture).toContain('ARG2=agent-123')
    expect(capture).toContain('ARG3=--extension')
    expect(capture).toContain('ARG4=/tmp/user-extension.ts')
    expect(capture).not.toContain(fixture.extensionPath)
  })

  itWithFish('degrades to the original argv when the managed extension is unavailable', () => {
    const fixture = makeFixture()
    const capture = runPrime(fixture, 'prime-agent ask', join(fixture.root, 'missing.ts'))

    expect(capture).toContain('ARG1=ask')
    expect(capture).not.toContain('ARG1=--extension')
  })

  itWithFish('keeps the stable guest endpoint path while its relay refreshes stale data', () => {
    const fixture = makeFixture()
    writeFileSync(fixture.endpointPath, 'ORCA_AGENT_HOOK_PORT=4567\nORCA_AGENT_HOOK_TOKEN=stale\n')

    const capture = runPrime(fixture, 'prime-agent ask')

    expect(capture).toContain(`ENDPOINT=${fixture.endpointPath}`)
    expect(capture).toContain('ARG1=--extension')
  })

  itWithFish('trims a trailing HOME slash before deriving the guest endpoint path', () => {
    const fixture = makeFixture()
    const result = spawnSync(
      'fish',
      ['--no-config', '-C', `source ${fixture.wrapper}`, '-c', 'prime-agent ask'],
      {
        cwd: fixture.root,
        env: {
          ...process.env,
          HOME: `${fixture.root}/`,
          PATH: `${join(fixture.root, 'bin')}:${process.env.PATH ?? ''}`,
          PRIME_AGENT_CODING_AGENT_DIR: fixture.primeHome,
          ORCA_PRIME_AGENT_STATUS_EXTENSION: fixture.extensionPath,
          ORCA_WSL_HOOK_INSTANCE: 'testinstance',
          ORCA_CAPTURE_FILE: fixture.capturePath
        },
        encoding: 'utf8'
      }
    )

    expect(result.status, result.stderr).toBe(0)
    expect(readFileSync(fixture.capturePath, 'utf8')).toContain(`ENDPOINT=${fixture.endpointPath}`)
  })

  itWithFish('leaves the inherited endpoint untouched when the WSL bridge env is absent', () => {
    const fixture = makeFixture()
    const result = spawnSync(
      'fish',
      ['--no-config', '-C', `source ${fixture.wrapper}`, '-c', 'prime-agent ask'],
      {
        cwd: fixture.root,
        env: {
          ...process.env,
          HOME: fixture.root,
          PATH: `${join(fixture.root, 'bin')}:${process.env.PATH ?? ''}`,
          PRIME_AGENT_CODING_AGENT_DIR: fixture.primeHome,
          ORCA_PRIME_AGENT_STATUS_EXTENSION: fixture.extensionPath,
          ORCA_AGENT_HOOK_ENDPOINT: '/mnt/c/current/endpoint.cmd',
          ORCA_CAPTURE_FILE: fixture.capturePath
        },
        encoding: 'utf8'
      }
    )

    expect(result.status, result.stderr).toBe(0)
    const capture = readFileSync(fixture.capturePath, 'utf8')
    expect(capture).toContain('ENDPOINT=/mnt/c/current/endpoint.cmd')
    expect(capture).toContain('ARG1=--extension')
  })

  itWithFish('does not define wrapper helpers when the bridge env is absent', () => {
    const fixture = makeFixture()
    const result = spawnSync(
      'fish',
      [
        '--no-config',
        '-C',
        `source ${fixture.wrapper}`,
        '-c',
        'functions -q __orca_prime_agent; and echo defined'
      ],
      {
        cwd: fixture.root,
        env: { ...process.env, ORCA_PRIME_AGENT_STATUS_EXTENSION: '' },
        encoding: 'utf8'
      }
    )

    expect(result.stdout.trim()).toBe('')
  })
})
