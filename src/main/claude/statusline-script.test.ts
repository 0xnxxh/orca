import { spawn } from 'node:child_process'
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { CLAUDE_STATUSLINE_MIN_POST_INTERVAL_SECONDS } from '../../shared/claude-statusline-rate-limits'
import { getManagedStatusLineScript } from './statusline-script'

const ORIGINAL_PLATFORM = process.platform

function stubPlatform(platform: NodeJS.Platform): void {
  Object.defineProperty(process, 'platform', { configurable: true, value: platform })
}

afterEach(() => {
  Object.defineProperty(process, 'platform', { configurable: true, value: ORIGINAL_PLATFORM })
})

describe('getManagedStatusLineScript (posix)', () => {
  it('guards on rate_limits before sourcing the endpoint or spawning curl', () => {
    stubPlatform('darwin')
    const script = getManagedStatusLineScript('local')
    expect(script).toBe(getManagedStatusLineScript('posix'))
    const guardIndex = script.indexOf('*\'"rate_limits"\'*')
    const endpointIndex = script.indexOf('ORCA_AGENT_HOOK_ENDPOINT')
    const curlIndex = script.indexOf('curl -sS')
    expect(guardIndex).toBeGreaterThan(-1)
    expect(guardIndex).toBeLessThan(endpointIndex)
    expect(endpointIndex).toBeLessThan(curlIndex)
    expect(script).toContain('/statusline/claude')
    expect(script).toContain('--data-urlencode "payload@-"')
  })

  it('returns the posix script even on win32 when targeting a remote', () => {
    stubPlatform('win32')
    const script = getManagedStatusLineScript('posix')
    expect(script).toContain('#!/bin/sh')
    expect(script).not.toContain('curl.exe')
  })
})

describe('getManagedStatusLineScript (win32 local)', () => {
  it('guards on rate_limits via findstr before the endpoint call and curl spawn', () => {
    stubPlatform('win32')
    const script = getManagedStatusLineScript('local')
    const captureIndex = script.indexOf('more.com')
    // Why: the \"-escaped needle makes findstr match the quoted JSON key, not any path containing rate_limits.
    const guardIndex = script.indexOf('findstr.exe" /c:\\"rate_limits\\"')
    const endpointIndex = script.indexOf('call "%ORCA_AGENT_HOOK_ENDPOINT%"')
    const curlIndex = script.indexOf('curl.exe')
    expect(captureIndex).toBeGreaterThan(-1)
    expect(guardIndex).toBeGreaterThan(captureIndex)
    expect(guardIndex).toBeLessThan(endpointIndex)
    expect(endpointIndex).toBeLessThan(curlIndex)
    expect(script).toContain('if errorlevel 1 goto :orca_statusline_cleanup')
  })

  it('posts the buffered payload file and deletes it afterwards', () => {
    stubPlatform('win32')
    const script = getManagedStatusLineScript('local')
    // Why: the temp file is per-pane (pane key with ":" mapped to "_") because %RANDOM%
    // collides across cmd instances spawned in the same second.
    expect(script).toContain(
      'set "ORCA_STATUSLINE_PAYLOAD_FILE=%TEMP%\\orca-claude-statusline-%ORCA_PANE_KEY::=_%.tmp"'
    )
    expect(script).toContain('--data-urlencode "payload@%ORCA_STATUSLINE_PAYLOAD_FILE%"')
    expect(script).not.toContain('payload@-')
    const curlIndex = script.indexOf('curl.exe')
    const delIndex = script.indexOf('del "%ORCA_STATUSLINE_PAYLOAD_FILE%"')
    expect(delIndex).toBeGreaterThan(curlIndex)
  })

  it('never posts a literal %CLAUDE_CONFIG_DIR% token when the var is unset', () => {
    stubPlatform('win32')
    const script = getManagedStatusLineScript('local')
    // Why: the posted field comes from an always-defined variable so an unset
    // CLAUDE_CONFIG_DIR yields "configDir=" (matching POSIX + the null snapshot).
    expect(script).toContain('set "ORCA_STATUSLINE_CONFIG_DIR_FIELD=configDir="')
    expect(script).toContain(
      'if defined CLAUDE_CONFIG_DIR set "ORCA_STATUSLINE_CONFIG_DIR_FIELD=configDir=%CLAUDE_CONFIG_DIR%"'
    )
    expect(script).toContain('--data-urlencode "%ORCA_STATUSLINE_CONFIG_DIR_FIELD%"')
    expect(script).not.toContain('"configDir=%CLAUDE_CONFIG_DIR%"')
  })

  it('drains stdin before exiting when the pane key is missing', () => {
    stubPlatform('win32')
    const script = getManagedStatusLineScript('local')
    const paneGuardIndex = script.indexOf(
      'if "%ORCA_PANE_KEY%"=="" goto :orca_agent_hook_drain_stdin'
    )
    const captureIndex = script.indexOf('more.com')
    expect(paneGuardIndex).toBeGreaterThan(-1)
    expect(paneGuardIndex).toBeLessThan(captureIndex)
    expect(script).toContain(':orca_agent_hook_drain_stdin')
  })

  it('throttles with an all-builtin seconds-of-day stamp that fails open to posting', () => {
    stubPlatform('win32')
    const script = getManagedStatusLineScript('local')
    const captureIndex = script.indexOf('more.com')
    const stampIndex = script.indexOf(
      'set "ORCA_STATUSLINE_STAMP_FILE=%TEMP%\\orca-claude-statusline-last-%ORCA_PANE_KEY::=_%.tmp"'
    )
    const throttleIndex = script.indexOf(
      `if %ORCA_STATUSLINE_ELAPSED% GEQ 0 if %ORCA_STATUSLINE_ELAPSED% LSS ${CLAUDE_STATUSLINE_MIN_POST_INTERVAL_SECONDS} goto :orca_statusline_cleanup`
    )
    const findstrIndex = script.indexOf('findstr.exe')
    const stampWriteIndex = script.indexOf(
      'if defined ORCA_STATUSLINE_NOW (>"%ORCA_STATUSLINE_STAMP_FILE%" echo %ORCA_STATUSLINE_NOW%)'
    )
    const tokenGuardIndex = script.indexOf('if "%ORCA_AGENT_HOOK_TOKEN%"=="" goto')
    const curlIndex = script.indexOf('curl.exe')
    // Why: the check precedes findstr so throttled ticks skip that spawn too, but the stamp
    // only advances after every post guard passes — skipped ticks must not defer the next post.
    expect(stampIndex).toBeGreaterThan(captureIndex)
    expect(throttleIndex).toBeGreaterThan(stampIndex)
    expect(throttleIndex).toBeLessThan(findstrIndex)
    expect(stampWriteIndex).toBeGreaterThan(tokenGuardIndex)
    expect(stampWriteIndex).toBeLessThan(curlIndex)
    // Fail-open shape: undefined elapsed (unparseable time/stamp) proceeds to the probe.
    expect(script).toContain('if not defined ORCA_STATUSLINE_ELAPSED goto :orca_statusline_probe')
    // cmd parses leading-zero numbers as octal; 1%%x %% 100 defuses 08/09.
    expect(script).toContain('(1%%a %% 100)*3600+(1%%b %% 100)*60+(1%%c %% 100)')
    expect(script).toContain('set "ORCA_STATUSLINE_TIME=%TIME: =0%"')
  })
})

describe('statusline curl throttle (posix)', () => {
  it('checks the per-pane stamp after the env guards and before curl', () => {
    stubPlatform('darwin')
    const script = getManagedStatusLineScript('local')
    const envGuardIndex = script.indexOf('-z "$ORCA_AGENT_HOOK_PORT"')
    const stampIndex = script.indexOf('orca-claude-statusline-last-${ORCA_PANE_KEY}')
    const intervalIndex = script.indexOf(`-lt ${CLAUDE_STATUSLINE_MIN_POST_INTERVAL_SECONDS}`)
    const curlIndex = script.indexOf('curl -sS')
    expect(envGuardIndex).toBeLessThan(stampIndex)
    expect(stampIndex).toBeLessThan(intervalIndex)
    expect(intervalIndex).toBeLessThan(curlIndex)
    // Fail-open shape: non-numeric date output or stamp content must never suppress the post.
    expect(script).toContain('case "$orca_statusline_now" in \'\'|*[!0-9]*) orca_statusline_now=')
    expect(script).toContain(
      'case "$orca_statusline_last" in \'\'|*[!0-9]*) orca_statusline_last=0'
    )
  })
})

describe.skipIf(process.platform === 'win32')('statusline curl throttle (posix behavioral)', () => {
  const PANE_KEY = 'tab-1:00000000-0000-4000-8000-000000000000'
  const RATE_LIMIT_PAYLOAD = '{"rate_limits":{"five_hour":{"used_percentage":12}}}'
  const dirs: string[] = []

  afterEach(() => {
    for (const dir of dirs.splice(0)) {
      rmSync(dir, { recursive: true, force: true })
    }
  })

  function makeHarness(): { scriptPath: string; dir: string; curlLog: string } {
    const dir = mkdtempSync(join(tmpdir(), 'orca-statusline-throttle-'))
    dirs.push(dir)
    const curlLog = join(dir, 'curl.log')
    const scriptPath = join(dir, 'statusline.sh')
    writeFileSync(scriptPath, getManagedStatusLineScript('posix'))
    const binDir = join(dir, 'stub-bin')
    mkdirSync(binDir, { recursive: true })
    writeFileSync(join(binDir, 'curl'), `#!/bin/sh\nprintf 'x\\n' >> "${curlLog}"\nexit 0\n`, {
      mode: 0o755
    })
    return { scriptPath, dir, curlLog }
  }

  function runScript(scriptPath: string, dir: string, payload: string): Promise<void> {
    return new Promise((resolve, reject) => {
      const child = spawn('sh', [scriptPath], {
        env: {
          PATH: `${join(dir, 'stub-bin')}:${process.env.PATH ?? ''}`,
          TMPDIR: dir,
          ORCA_AGENT_HOOK_PORT: '65535',
          ORCA_AGENT_HOOK_TOKEN: 'test-token',
          ORCA_PANE_KEY: PANE_KEY
        },
        stdio: ['pipe', 'ignore', 'pipe']
      })
      let stderr = ''
      child.stderr.on('data', (chunk: Buffer) => {
        stderr += chunk.toString()
      })
      child.on('error', reject)
      child.on('close', (code) => {
        if (code === 0) {
          resolve()
        } else {
          reject(new Error(`statusline script exited ${code}: ${stderr}`))
        }
      })
      child.stdin.write(payload)
      child.stdin.end()
    })
  }

  function curlCount(curlLog: string): number {
    try {
      return readFileSync(curlLog, 'utf8').split('\n').filter(Boolean).length
    } catch {
      return 0
    }
  }

  function stampPathFor(dir: string): string {
    return join(dir, `orca-claude-statusline-last-${PANE_KEY}`)
  }

  it('spawns curl once across rapid ticks, not once per tick', async () => {
    const { scriptPath, dir, curlLog } = makeHarness()
    await runScript(scriptPath, dir, RATE_LIMIT_PAYLOAD)
    await runScript(scriptPath, dir, RATE_LIMIT_PAYLOAD)
    await runScript(scriptPath, dir, RATE_LIMIT_PAYLOAD)
    expect(curlCount(curlLog)).toBe(1)
    expect(readFileSync(stampPathFor(dir), 'utf8')).toMatch(/^[0-9]+$/)
  })

  it('posts again once the interval has elapsed', async () => {
    const { scriptPath, dir, curlLog } = makeHarness()
    await runScript(scriptPath, dir, RATE_LIMIT_PAYLOAD)
    const expired = Math.floor(Date.now() / 1000) - CLAUDE_STATUSLINE_MIN_POST_INTERVAL_SECONDS - 1
    writeFileSync(stampPathFor(dir), String(expired))
    await runScript(scriptPath, dir, RATE_LIMIT_PAYLOAD)
    expect(curlCount(curlLog)).toBe(2)
  })

  it('fails open and posts when the stamp file holds garbage', async () => {
    const { scriptPath, dir, curlLog } = makeHarness()
    writeFileSync(stampPathFor(dir), 'not-a-number')
    await runScript(scriptPath, dir, RATE_LIMIT_PAYLOAD)
    expect(curlCount(curlLog)).toBe(1)
    expect(readFileSync(stampPathFor(dir), 'utf8')).toMatch(/^[0-9]+$/)
  })

  it('never touches curl or the stamp for payloads without rate_limits', async () => {
    const { scriptPath, dir, curlLog } = makeHarness()
    await runScript(scriptPath, dir, '{"model":{"id":"claude-fable-5"}}')
    expect(curlCount(curlLog)).toBe(0)
    expect(() => readFileSync(stampPathFor(dir), 'utf8')).toThrow()
  })
})
