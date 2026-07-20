import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { execFileSync } from 'node:child_process'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import {
  SshChannelMultiplexer,
  type MultiplexerTransport
} from '../main/ssh/ssh-channel-multiplexer'
import { RelayDispatcher } from './dispatcher'
import { PtyHandler } from './pty-handler'

function quotePowerShell(value: string): string {
  return `'${value.replaceAll("'", "''")}'`
}

async function waitFor(predicate: () => boolean, timeoutMs = 15_000): Promise<void> {
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    if (predicate()) {
      return
    }
    await new Promise((resolve) => setTimeout(resolve, 50))
  }
  throw new Error('Timed out waiting for Windows relay process evidence')
}

describe.skipIf(process.platform !== 'win32')('Windows relay agent Job integration', () => {
  let rootDir: string
  let dispatcher: RelayDispatcher
  let handler: PtyHandler
  let mux: SshChannelMultiplexer
  let lockHolderPid: number | null

  beforeEach(() => {
    rootDir = mkdtempSync(join(tmpdir(), 'orca-relay-job-'))
    lockHolderPid = null
    let feedRelay: (data: Buffer) => void
    const clientDataCallbacks: ((data: Buffer) => void)[] = []
    const clientTransport: MultiplexerTransport = {
      write: (data) => setImmediate(() => feedRelay(data)),
      onData: (callback) => clientDataCallbacks.push(callback),
      onClose: () => {}
    }
    dispatcher = new RelayDispatcher((data) => {
      setImmediate(() => clientDataCallbacks.forEach((callback) => callback(data)))
    })
    feedRelay = (data) => dispatcher.feed(data)
    handler = new PtyHandler(dispatcher)
    mux = new SshChannelMultiplexer(clientTransport)
  })

  afterEach(async () => {
    mux.dispose()
    dispatcher.dispose()
    await handler.dispose({ waitForPhysicalExit: false }).catch(() => {})
    if (lockHolderPid) {
      try {
        execFileSync('taskkill.exe', ['/PID', String(lockHolderPid), '/T', '/F'], {
          stdio: 'ignore'
        })
      } catch {
        /* already gone */
      }
    }
    rmSync(rootDir, { recursive: true, force: true })
  })

  it('drains a detached lock-holder before acknowledging remote shutdown', async () => {
    const worktreeDir = join(rootDir, 'worktree')
    const lockPath = join(worktreeDir, 'held.lock')
    const pidPath = join(rootDir, 'lock-holder.pid')
    const childScriptPath = join(rootDir, 'hold-lock.ps1')
    const rootScriptPath = join(rootDir, 'launch-child.ps1')
    mkdirSync(worktreeDir)
    writeFileSync(
      childScriptPath,
      [
        'param([string]$LockPath, [string]$PidPath)',
        "$stream = [IO.File]::Open($LockPath, 'OpenOrCreate', 'ReadWrite', 'Read')",
        '[IO.File]::WriteAllText($PidPath, [string]$PID)',
        'try { while ($true) { Start-Sleep -Milliseconds 250 } } finally { $stream.Dispose() }'
      ].join('\r\n')
    )
    writeFileSync(
      rootScriptPath,
      [
        'param([string]$ChildScript, [string]$LockPath, [string]$PidPath)',
        '$childArgs = "-NoLogo -NoProfile -ExecutionPolicy Bypass -File `"$ChildScript`" -LockPath `"$LockPath`" -PidPath `"$PidPath`""',
        '$child = Start-Process powershell.exe -WindowStyle Hidden -PassThru -ArgumentList $childArgs',
        'while (-not (Test-Path -LiteralPath $PidPath)) { Start-Sleep -Milliseconds 50 }',
        'while ($true) { Start-Sleep -Milliseconds 250 }'
      ].join('\r\n')
    )
    writeFileSync(lockPath, '')
    const command =
      `& ${quotePowerShell(rootScriptPath)}` +
      ` -ChildScript ${quotePowerShell(childScriptPath)}` +
      ` -LockPath ${quotePowerShell(lockPath)}` +
      ` -PidPath ${quotePowerShell(pidPath)}`

    const spawned = (await mux.request('pty.spawn', {
      cols: 80,
      rows: 24,
      cwd: rootDir,
      shellOverride: 'powershell.exe',
      command,
      commandDelivery: 'provider',
      launchAgent: 'claude'
    })) as { id: string }
    await waitFor(() => existsSync(pidPath))
    lockHolderPid = Number(readFileSync(pidPath, 'utf8').trim())
    expect(lockHolderPid).toBeGreaterThan(0)
    // Why: prove the child holds a real Windows delete-denying handle before teardown.
    expect(() => rmSync(lockPath, { force: true })).toThrow()

    await mux.request('pty.shutdown', { id: spawned.id, immediate: true })
    await waitFor(() => {
      try {
        process.kill(lockHolderPid!, 0)
        return false
      } catch {
        return true
      }
    })

    rmSync(worktreeDir, { recursive: true, force: true })
    expect(existsSync(worktreeDir)).toBe(false)
    lockHolderPid = null
  }, 30_000)
})
