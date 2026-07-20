import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { spawnSync } from 'node:child_process'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test, expect } from './helpers/orca-app'
import { waitForActiveWorktree, waitForSessionReady } from './helpers/store'

type ExitObservation = {
  code: number
  childAlive: boolean
  observedAt: number
}

function isProcessAlive(pid: number): boolean {
  if (!Number.isInteger(pid) || pid <= 0) {
    return false
  }
  try {
    process.kill(pid, 0)
    return true
  } catch {
    return false
  }
}

function quotePowerShellArg(value: string): string {
  return `'${value.replaceAll("'", "''")}'`
}

async function delay(ms: number): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, ms))
}

async function forceKillWindowsPid(pid: number): Promise<boolean> {
  if (!isProcessAlive(pid)) {
    return true
  }
  const taskkill = process.env.SystemRoot
    ? join(process.env.SystemRoot, 'System32', 'taskkill.exe')
    : 'taskkill'
  for (let attempt = 0; attempt < 5 && isProcessAlive(pid); attempt++) {
    spawnSync(taskkill, ['/PID', String(pid), '/F'], { windowsHide: true, stdio: 'ignore' })
    await delay(250)
  }
  return !isProcessAlive(pid)
}

test('natural Windows agent root exit waits for Job descendants before public PTY exit', async ({
  orcaPage
}, testInfo) => {
  test.skip(process.platform !== 'win32', 'requires native Windows ConPTY and Job Objects')

  const stage = mkdtempSync(join(tmpdir(), 'orca-windows-agent-natural-exit-'))
  const agentScript = join(stage, 'agent.cjs')
  const childScript = join(stage, 'child.cjs')
  const releasePath = join(stage, 'release')
  const rootPidPath = join(stage, 'root.pid')
  const agentPidPath = join(stage, 'agent.pid')
  const childPidPath = join(stage, 'child.pid')
  const powershellPath = join(
    process.env.SystemRoot ?? 'C:\\Windows',
    'System32',
    'WindowsPowerShell',
    'v1.0',
    'powershell.exe'
  )

  writeFileSync(
    childScript,
    [
      "const { writeFileSync } = require('node:fs')",
      'writeFileSync(process.argv[2], String(process.pid))',
      'setInterval(() => {}, 1000)',
      ''
    ].join('\n')
  )
  writeFileSync(
    agentScript,
    [
      "const { existsSync, writeFileSync } = require('node:fs')",
      "const { spawn } = require('node:child_process')",
      'writeFileSync(process.argv[2], String(process.pid))',
      'const child = spawn(process.execPath, [process.argv[3], process.argv[4]], {',
      "  cwd: process.cwd(), detached: true, stdio: 'ignore', windowsHide: true",
      '})',
      'child.unref()',
      'const poll = setInterval(() => {',
      '  if (existsSync(process.argv[5])) { clearInterval(poll); process.exit(0) }',
      '}, 25)',
      ''
    ].join('\n')
  )

  let ptyId = ''
  let rootPid = 0
  let agentPid = 0
  let childPid = 0
  let exitObservation: ExitObservation | null = null
  const cleanupFailures: string[] = []
  const evidence: Record<string, unknown> = { stage }

  await orcaPage.exposeFunction('__orcaRecordWindowsAgentJobExit', ({ code }: { code: number }) => {
    exitObservation = { code, childAlive: isProcessAlive(childPid), observedAt: Date.now() }
  })

  try {
    await waitForSessionReady(orcaPage)
    const worktreeId = await waitForActiveWorktree(orcaPage)
    const command = [
      `[IO.File]::WriteAllText(${quotePowerShellArg(rootPidPath)}, [string]$PID);`,
      '&',
      quotePowerShellArg(process.execPath),
      quotePowerShellArg(agentScript),
      quotePowerShellArg(agentPidPath),
      quotePowerShellArg(childScript),
      quotePowerShellArg(childPidPath),
      quotePowerShellArg(releasePath),
      '; exit $LASTEXITCODE'
    ].join(' ')

    ptyId = await orcaPage.evaluate(
      async ({ command: startupCommand, cwd, shellOverride, worktreeId: wt }) => {
        const result = await window.api.pty.spawn({
          cols: 120,
          rows: 40,
          cwd,
          command: startupCommand,
          launchAgent: 'claude',
          shellOverride,
          worktreeId: wt
        })
        return result.id
      },
      { command, cwd: stage, shellOverride: powershellPath, worktreeId }
    )

    await orcaPage.evaluate((id) => {
      const target = window as typeof window & {
        __orcaRecordWindowsAgentJobExit: (payload: { code: number }) => Promise<void>
        __orcaDisposeWindowsAgentJobExit?: () => void
      }
      target.__orcaDisposeWindowsAgentJobExit = window.api.pty.onExit((payload) => {
        if (payload.id === id) {
          void target.__orcaRecordWindowsAgentJobExit({ code: payload.code })
        }
      })
    }, ptyId)

    await expect
      .poll(() => existsSync(childPidPath), {
        timeout: 20_000,
        message: 'agent never spawned its detached native child'
      })
      .toBe(true)
    agentPid = Number(readFileSync(agentPidPath, 'utf8').trim())
    childPid = Number(readFileSync(childPidPath, 'utf8').trim())
    const management = await orcaPage.evaluate(async (id) => {
      const result = await window.api.pty.management.listSessions()
      const session = result.sessions.find((candidate) => candidate.sessionId === id)
      return session ? { pid: session.pid, protocolVersion: session.protocolVersion } : null
    }, ptyId)
    // Why: v24 sessions predate spawn-time Job ownership, so only a new v25
    // session can prove the natural-exit drain contract under test.
    expect(management?.protocolVersion).toBe(25)
    rootPid = management?.pid ?? 0
    expect(rootPid).toBe(Number(readFileSync(rootPidPath, 'utf8').trim()))
    expect(rootPid).toBeGreaterThan(0)
    expect(agentPid).toBeGreaterThan(0)
    expect(childPid).toBeGreaterThan(0)
    expect(isProcessAlive(rootPid)).toBe(true)
    expect(isProcessAlive(agentPid)).toBe(true)
    expect(isProcessAlive(childPid)).toBe(true)
    await delay(500)
    expect(isProcessAlive(childPid), 'detached child must be long-lived before release').toBe(true)
    evidence.before = { ptyId, rootPid, agentPid, childPid }

    writeFileSync(releasePath, 'release')
    await expect
      .poll(
        () => ({
          publicExit: exitObservation !== null,
          rootAlive: isProcessAlive(rootPid),
          agentAlive: isProcessAlive(agentPid),
          childAlive: isProcessAlive(childPid)
        }),
        { timeout: 20_000, intervals: [10, 10, 25, 50, 100] }
      )
      .toEqual({ publicExit: true, rootAlive: false, agentAlive: false, childAlive: false })
    expect(exitObservation?.childAlive, 'public exit arrived before the Job drained').toBe(false)
    expect(exitObservation?.code).toBe(0)
    await expect.poll(() => orcaPage.evaluate((id) => window.api.pty.hasPty(id), ptyId)).toBe(false)
    evidence.after = { exitObservation, rootAlive: false, agentAlive: false, childAlive: false }
  } finally {
    await orcaPage
      .evaluate(() => {
        const target = window as typeof window & {
          __orcaDisposeWindowsAgentJobExit?: () => void
        }
        target.__orcaDisposeWindowsAgentJobExit?.()
        delete target.__orcaDisposeWindowsAgentJobExit
      })
      .catch(() => undefined)
    if (ptyId) {
      await orcaPage.evaluate((id) => window.api.pty.kill(id), ptyId).catch(() => undefined)
    }
    for (const [name, pid] of [
      ['root', rootPid],
      ['agent', agentPid],
      ['child', childPid]
    ] as const) {
      if (!(await forceKillWindowsPid(pid))) {
        cleanupFailures.push(`${name} process ${pid} remained alive`)
      }
    }
    evidence.cleanupFailures = cleanupFailures
    const evidencePath = testInfo.outputPath('windows-agent-job-natural-exit-evidence.json')
    writeFileSync(evidencePath, JSON.stringify(evidence, null, 2))
    await testInfo.attach('windows-agent-job-natural-exit-evidence.json', {
      path: evidencePath,
      contentType: 'application/json'
    })
    if (cleanupFailures.length === 0) {
      rmSync(stage, { recursive: true, force: true })
    }
  }

  expect(cleanupFailures, `Windows E2E cleanup failed: ${cleanupFailures.join('; ')}`).toEqual([])
})
