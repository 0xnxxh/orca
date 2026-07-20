import { chmodSync, existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { spawnSync } from 'node:child_process'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { test, expect } from './helpers/orca-app'
import { waitForActiveWorktree, waitForSessionReady } from './helpers/store'

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

function readMarkerPid(path: string): number {
  return Number(readFileSync(path, 'utf8').trim())
}

function recoverMarkerPid(path: string, current: number): number {
  if (Number.isInteger(current) && current > 0) {
    return current
  }
  try {
    const recovered = readMarkerPid(path)
    return Number.isInteger(recovered) && recovered > 0 ? recovered : current
  } catch {
    return current
  }
}

const CLEANUP_RETRY_COUNT = 5
const CLEANUP_RETRY_DELAY_MS = 250

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

async function requireProcessAliveFor(pid: number, durationMs: number): Promise<void> {
  const deadline = Date.now() + durationMs
  while (Date.now() < deadline) {
    expect(isProcessAlive(pid), `process ${pid} exited during the observation window`).toBe(true)
    await delay(100)
  }
}

async function killExactWindowsPid(pid: number): Promise<{ pid: number; alive: boolean }> {
  if (!Number.isInteger(pid) || pid <= 0) {
    return { pid, alive: false }
  }
  const taskkill = process.env.SystemRoot
    ? join(process.env.SystemRoot, 'System32', 'taskkill.exe')
    : 'taskkill'
  for (let attempt = 0; attempt < CLEANUP_RETRY_COUNT && isProcessAlive(pid); attempt++) {
    spawnSync(taskkill, ['/PID', String(pid), '/F'], { windowsHide: true, stdio: 'ignore' })
    await delay(CLEANUP_RETRY_DELAY_MS)
  }
  return { pid, alive: isProcessAlive(pid) }
}

function quotePowerShellArg(value: string): string {
  return `'${value.replaceAll("'", "''")}'`
}

async function createIsolatedWorktree(
  page: Parameters<typeof waitForActiveWorktree>[0]
): Promise<{ id: string; path: string; repoPath: string }> {
  return page.evaluate(async (name) => {
    const store = window.__store
    if (!store) {
      throw new Error('window.__store is unavailable')
    }
    const state = store.getState()
    const active = Object.values(state.worktreesByRepo)
      .flat()
      .find((worktree) => worktree.id === state.activeWorktreeId)
    if (!active) {
      throw new Error('active worktree is unavailable')
    }
    const result = await state.createWorktree(active.repoId, name)
    await state.fetchWorktrees(active.repoId)
    return { id: result.worktree.id, path: result.worktree.path, repoPath: active.path }
  }, `e2e-windows-agent-tree-${Date.now()}`)
}

async function removeWorktreeViaStore(
  page: Parameters<typeof waitForActiveWorktree>[0],
  worktreeId: string
): Promise<{ ok: boolean; error?: string }> {
  return page.evaluate(async (id) => {
    const store = window.__store
    if (!store) {
      return { ok: false as const, error: 'store unavailable' }
    }
    return store.getState().removeWorktree(id, true)
  }, worktreeId)
}

async function isWorktreeListed(
  page: Parameters<typeof waitForActiveWorktree>[0],
  worktreeId: string
): Promise<boolean> {
  return page.evaluate((id) => {
    const store = window.__store
    return store
      ? Object.values(store.getState().worktreesByRepo)
          .flat()
          .some((item) => item.id === id)
      : false
  }, worktreeId)
}

function inspectGitWorktreeRegistration(
  repoPath: string,
  worktreePath: string
): { registered: boolean; error?: string } {
  const result = spawnSync('git', ['-C', repoPath, 'worktree', 'list', '--porcelain'], {
    windowsHide: true,
    encoding: 'utf8'
  })
  if (result.error || result.status !== 0) {
    return {
      registered: true,
      error: result.error?.message ?? result.stderr.trim() ?? `exit ${result.status}`
    }
  }
  const target = resolve(worktreePath)
  const normalize = (path: string): string => {
    const absolute = resolve(path)
    return process.platform === 'win32' ? absolute.toLowerCase() : absolute
  }
  return {
    registered: result.stdout
      .split(/\r?\n/)
      .filter((line) => line.startsWith('worktree '))
      .map((line) => line.slice('worktree '.length))
      .some((path) => normalize(path) === normalize(target))
  }
}

async function cleanupCreatedWorktree(
  page: Parameters<typeof waitForActiveWorktree>[0],
  created: { id: string; path: string; repoPath: string }
): Promise<{ exists: boolean; listed: boolean; registered: boolean; errors: string[] }> {
  const errors: string[] = []
  for (let attempt = 0; attempt < CLEANUP_RETRY_COUNT; attempt++) {
    const storeResult = await removeWorktreeViaStore(page, created.id).catch((error: unknown) => ({
      ok: false,
      error: error instanceof Error ? error.message : String(error)
    }))
    if (!storeResult.ok && storeResult.error) {
      errors.push(`store attempt ${attempt + 1}: ${storeResult.error}`)
    }
    const registrationBefore = inspectGitWorktreeRegistration(created.repoPath, created.path)
    if (registrationBefore.error) {
      errors.push(`git list attempt ${attempt + 1}: ${registrationBefore.error}`)
    }
    if (existsSync(created.path) || registrationBefore.registered) {
      const gitResult = spawnSync(
        'git',
        ['-C', created.repoPath, 'worktree', 'remove', '--force', created.path],
        { windowsHide: true, encoding: 'utf8' }
      )
      if (gitResult.error || gitResult.status !== 0) {
        errors.push(
          `git attempt ${attempt + 1}: ${gitResult.error?.message ?? gitResult.stderr.trim() ?? `exit ${gitResult.status}`}`
        )
      }
    }
    if (!existsSync(created.path) && registrationBefore.registered) {
      const pruneResult = spawnSync(
        'git',
        ['-C', created.repoPath, 'worktree', 'prune', '--expire', 'now'],
        { windowsHide: true, encoding: 'utf8' }
      )
      if (pruneResult.error || pruneResult.status !== 0) {
        errors.push(
          `git prune attempt ${attempt + 1}: ${pruneResult.error?.message ?? pruneResult.stderr.trim() ?? `exit ${pruneResult.status}`}`
        )
      }
    }
    const listed = await isWorktreeListed(page, created.id).catch(() => true)
    const registrationAfter = inspectGitWorktreeRegistration(created.repoPath, created.path)
    if (registrationAfter.error) {
      errors.push(`git list attempt ${attempt + 1} after cleanup: ${registrationAfter.error}`)
    }
    if (!existsSync(created.path) && !listed && !registrationAfter.registered) {
      return { exists: false, listed: false, registered: false, errors }
    }
    await delay(CLEANUP_RETRY_DELAY_MS)
  }
  return {
    exists: existsSync(created.path),
    listed: await isWorktreeListed(page, created.id).catch(() => true),
    registered: inspectGitWorktreeRegistration(created.repoPath, created.path).registered,
    errors
  }
}

// Reproduces the orphaned-descendant battery-drain incident (STA-1800): an
// agent CLI spawns a tool child in a detached process group, the session is
// killed, and the child must not survive. The stand-in agent's first command
// token is literally `claude` so PTY spawn recognition marks the session as an
// agent; tab close → pty.kill routing is already covered by
// terminal-parked-close-retirement.spec.ts, so this spec drives pty.kill.
test('killing an agent PTY terminates its detached-pgid descendants', async ({ orcaPage }) => {
  test.skip(process.platform === 'win32', 'descendant tree-kill is POSIX-only for now')

  const stage = mkdtempSync(join(tmpdir(), 'orca-agent-descendant-'))
  const markerPath = join(stage, 'detached-child.pid')
  const spawnerPath = join(stage, 'spawn-detached.cjs')
  writeFileSync(
    spawnerPath,
    [
      "const { spawn } = require('node:child_process')",
      // detached:true → setsid → own pgid/session, exactly the topology of an
      // agent CLI's tool subprocess that a dying shell's SIGHUP cannot reach.
      "const child = spawn('sleep', ['31337'], { detached: true, stdio: 'ignore' })",
      'child.unref()',
      "require('node:fs').writeFileSync(process.argv[2], String(child.pid))",
      // Stay alive like a real agent at its prompt: the detached child's ppid
      // must remain intact at kill time — a pre-orphaned child is the separate
      // crash-path scenario that only the PR-2 sweep can catch.
      'setInterval(() => {}, 1000)',
      ''
    ].join('\n')
  )
  const fakeAgentPath = join(stage, 'claude')
  writeFileSync(fakeAgentPath, `#!/bin/sh\nexec "${process.execPath}" "${spawnerPath}" "$1"\n`)
  chmodSync(fakeAgentPath, 0o755)

  let detachedChildPid = 0
  try {
    await waitForSessionReady(orcaPage)
    const worktreeId = await waitForActiveWorktree(orcaPage)

    const ptyId = await orcaPage.evaluate(
      async ({ command, cwd, worktreeId: wt }) => {
        const result = await window.api.pty.spawn({
          cols: 120,
          rows: 40,
          cwd,
          command,
          launchAgent: 'claude',
          worktreeId: wt
        })
        return result.id
      },
      { command: `'${fakeAgentPath}' '${markerPath}'`, cwd: stage, worktreeId }
    )
    expect(ptyId).toBeTruthy()

    await expect
      .poll(() => existsSync(markerPath), {
        timeout: 20_000,
        message: 'stand-in agent never spawned its detached child'
      })
      .toBe(true)
    detachedChildPid = Number(readFileSync(markerPath, 'utf8').trim())
    expect(detachedChildPid).toBeGreaterThan(0)
    expect(isProcessAlive(detachedChildPid)).toBe(true)

    await orcaPage.evaluate((id) => window.api.pty.kill(id), ptyId)

    await expect
      .poll(() => isProcessAlive(detachedChildPid), {
        timeout: 15_000,
        message: `detached descendant ${detachedChildPid} survived the agent PTY kill`
      })
      .toBe(false)
  } finally {
    if (detachedChildPid > 0 && isProcessAlive(detachedChildPid)) {
      try {
        process.kill(detachedChildPid, 'SIGKILL')
      } catch {
        /* already gone */
      }
    }
    rmSync(stage, { recursive: true, force: true })
  }
})

test('Windows worktree deletion releases a reparented agent descendant file lock', async ({
  orcaPage
}, testInfo) => {
  test.skip(process.platform !== 'win32', 'requires native Windows ConPTY and file locking')

  const stage = mkdtempSync(join(tmpdir(), 'orca-windows-agent-tree-'))
  const agentScript = join(stage, 'agent.cjs')
  const launcherScript = join(stage, 'launcher.cjs')
  const lockHolderSource = join(stage, 'lock-holder.cs')
  const lockHolderExe = join(stage, 'lock-holder.exe')
  const agentPidPath = join(stage, 'agent.pid')
  const rootPidPath = join(stage, 'root.pid')
  const launcherPidPath = join(stage, 'launcher.pid')
  const lockHolderPidPath = join(stage, 'lock-holder.pid')
  const lockReadyPath = join(stage, 'lock.ready')
  const powershellPath = join(
    process.env.SystemRoot ?? 'C:\\Windows',
    'System32',
    'WindowsPowerShell',
    'v1.0',
    'powershell.exe'
  )
  writeFileSync(
    lockHolderSource,
    [
      'using System.Diagnostics;',
      'using System.IO;',
      'using System.Threading;',
      'internal static class LockHolder {',
      '  private static void Main(string[] args) {',
      '    File.WriteAllText(args[1], Process.GetCurrentProcess().Id.ToString());',
      '    using (var stream = new FileStream(args[0], FileMode.Open, FileAccess.Read, FileShare.None)) {',
      '      File.WriteAllText(args[2], "locked");',
      '      Thread.Sleep(Timeout.Infinite);',
      '    }',
      '  }',
      '}',
      ''
    ].join('\n')
  )
  const windowsRoot = process.env.SystemRoot ?? 'C:\\Windows'
  const csharpCompiler = [
    join(windowsRoot, 'Microsoft.NET', 'Framework64', 'v4.0.30319', 'csc.exe'),
    join(windowsRoot, 'Microsoft.NET', 'Framework', 'v4.0.30319', 'csc.exe')
  ].find((candidate) => existsSync(candidate))
  expect(csharpCompiler, '.NET Framework C# compiler is required for the lock fixture').toBeTruthy()
  const compileResult = spawnSync(
    csharpCompiler!,
    ['/nologo', '/target:exe', `/out:${lockHolderExe}`, lockHolderSource],
    { windowsHide: true, encoding: 'utf8' }
  )
  expect(
    compileResult.status,
    compileResult.error?.message ?? compileResult.stderr ?? 'lock-holder compilation failed'
  ).toBe(0)
  writeFileSync(
    launcherScript,
    [
      "const { spawn } = require('node:child_process')",
      "const { existsSync, writeFileSync } = require('node:fs')",
      'writeFileSync(process.argv[2], String(process.pid))',
      'const child = spawn(process.argv[3], process.argv.slice(4, 7), {',
      "  cwd: process.argv[7], detached: true, stdio: 'ignore', windowsHide: true",
      '})',
      'child.unref()',
      'const deadline = Date.now() + 10_000',
      'const readyPoll = setInterval(() => {',
      '  if (existsSync(process.argv[6])) { clearInterval(readyPoll); process.exit(0) }',
      '  if (Date.now() >= deadline) { clearInterval(readyPoll); process.exit(2) }',
      '}, 25)',
      ''
    ].join('\n')
  )
  writeFileSync(
    agentScript,
    [
      "const { spawn } = require('node:child_process')",
      "const { writeFileSync } = require('node:fs')",
      'writeFileSync(process.argv[2], String(process.pid))',
      'const launcher = spawn(process.execPath, process.argv.slice(3), {',
      "  cwd: process.argv[process.argv.length - 1], stdio: 'ignore', windowsHide: true",
      '})',
      'launcher.unref()',
      'setInterval(() => {}, 1000)',
      ''
    ].join('\n')
  )

  let created: { id: string; path: string; repoPath: string } | null = null
  let ptyId = ''
  let rootPid = 0
  let agentPid = 0
  let launcherPid = 0
  let lockHolderPid = 0
  let removalResult: { ok: boolean; error?: string } | null = null
  const cleanupFailures: string[] = []
  const evidence: Record<string, unknown> = { stage }

  try {
    await waitForSessionReady(orcaPage)
    await waitForActiveWorktree(orcaPage)
    created = await createIsolatedWorktree(orcaPage)
    const lockedPath = join(created.path, 'README.md')
    expect(existsSync(lockedPath), 'fixture worktree must contain tracked README.md').toBe(true)
    const initialGitRegistration = inspectGitWorktreeRegistration(created.repoPath, created.path)
    expect(initialGitRegistration.error).toBeUndefined()
    expect(
      initialGitRegistration.registered,
      'fixture worktree must be Git-registered before destructive removal'
    ).toBe(true)

    const command = [
      `[IO.File]::WriteAllText(${quotePowerShellArg(rootPidPath)}, [string]$PID);`,
      '&',
      quotePowerShellArg(process.execPath),
      quotePowerShellArg(agentScript),
      quotePowerShellArg(agentPidPath),
      quotePowerShellArg(launcherScript),
      quotePowerShellArg(launcherPidPath),
      quotePowerShellArg(lockHolderExe),
      quotePowerShellArg(lockedPath),
      quotePowerShellArg(lockHolderPidPath),
      quotePowerShellArg(lockReadyPath),
      quotePowerShellArg(created.path)
    ].join(' ')
    ptyId = await orcaPage.evaluate(
      async ({ command: startupCommand, cwd, worktreeId, shellOverride }) => {
        const result = await window.api.pty.spawn({
          cols: 120,
          rows: 40,
          cwd,
          command: startupCommand,
          launchAgent: 'claude',
          shellOverride,
          worktreeId
        })
        return result.id
      },
      { command, cwd: created.path, worktreeId: created.id, shellOverride: powershellPath }
    )

    await expect
      .poll(() => existsSync(lockReadyPath), {
        timeout: 30_000,
        message: 'reparented native descendant never acquired the worktree file lock'
      })
      .toBe(true)
    agentPid = readMarkerPid(agentPidPath)
    launcherPid = readMarkerPid(launcherPidPath)
    lockHolderPid = readMarkerPid(lockHolderPidPath)
    await expect
      .poll(() => isProcessAlive(launcherPid), {
        timeout: 10_000,
        message: 'short-lived launcher did not exit, so the test did not reach the reparented shape'
      })
      .toBe(false)

    const management = await orcaPage.evaluate(async (id) => {
      const result = await window.api.pty.management.listSessions()
      const session = result.sessions.find((candidate) => candidate.sessionId === id)
      return session
        ? { pid: session.pid, protocolVersion: session.protocolVersion, degraded: result.degraded }
        : null
    }, ptyId)
    expect(management?.degraded).toBe(false)
    // Why: adopted v24 sessions predate spawn-time Job ownership; this proof
    // must exercise a newly launched v25 agent session.
    expect(management?.protocolVersion).toBe(25)
    rootPid = management?.pid ?? 0
    expect(rootPid).toBeGreaterThan(0)
    expect(isProcessAlive(rootPid)).toBe(true)
    expect(isProcessAlive(agentPid)).toBe(true)
    expect(isProcessAlive(lockHolderPid)).toBe(true)

    evidence.before = {
      ptyId,
      worktreeId: created.id,
      worktreePath: created.path,
      protocolVersion: management?.protocolVersion,
      rootPid,
      agentPid,
      launcherPid,
      lockHolderPid,
      rootAlive: isProcessAlive(rootPid),
      agentAlive: isProcessAlive(agentPid),
      launcherAlive: isProcessAlive(launcherPid),
      lockHolderAlive: isProcessAlive(lockHolderPid),
      gitWorktreeRegistered: initialGitRegistration.registered
    }

    removalResult = await removeWorktreeViaStore(orcaPage, created.id)
    evidence.removalResult = removalResult
    expect(removalResult.ok, removalResult.error ?? 'worktree removal failed').toBe(true)

    await expect.poll(() => orcaPage.evaluate((id) => window.api.pty.hasPty(id), ptyId)).toBe(false)
    await expect.poll(() => isProcessAlive(rootPid), { timeout: 15_000 }).toBe(false)
    await expect.poll(() => isProcessAlive(agentPid), { timeout: 15_000 }).toBe(false)
    await expect.poll(() => isProcessAlive(lockHolderPid), { timeout: 15_000 }).toBe(false)
    expect(existsSync(created.path)).toBe(false)
    const gitRegistration = inspectGitWorktreeRegistration(created.repoPath, created.path)
    expect(gitRegistration.error).toBeUndefined()
    expect(gitRegistration.registered, 'Git still registered the removed worktree').toBe(false)
    const remainingIds = await orcaPage.evaluate(() => {
      const store = window.__store
      return store
        ? Object.values(store.getState().worktreesByRepo)
            .flat()
            .map((item) => item.id)
        : []
    })
    expect(remainingIds).not.toContain(created.id)
    evidence.after = {
      ptyPresent: await orcaPage.evaluate((id) => window.api.pty.hasPty(id), ptyId),
      rootAlive: isProcessAlive(rootPid),
      agentAlive: isProcessAlive(agentPid),
      lockHolderAlive: isProcessAlive(lockHolderPid),
      worktreeExists: existsSync(created.path),
      gitWorktreeRegistered: gitRegistration.registered,
      worktreeListed: remainingIds.includes(created.id)
    }
  } finally {
    rootPid = recoverMarkerPid(rootPidPath, rootPid)
    agentPid = recoverMarkerPid(agentPidPath, agentPid)
    launcherPid = recoverMarkerPid(launcherPidPath, launcherPid)
    lockHolderPid = recoverMarkerPid(lockHolderPidPath, lockHolderPid)
    if (!rootPid && ptyId) {
      rootPid = await orcaPage
        .evaluate(async (id) => {
          const result = await window.api.pty.management.listSessions()
          return result.sessions.find((candidate) => candidate.sessionId === id)?.pid ?? 0
        }, ptyId)
        .catch(() => 0)
    }
    if (ptyId) {
      await orcaPage.evaluate((id) => window.api.pty.kill(id), ptyId).catch(() => undefined)
    }
    const processCleanup = []
    rootPid = recoverMarkerPid(rootPidPath, rootPid)
    const rootCleanup = await killExactWindowsPid(rootPid)
    processCleanup.push(rootCleanup)
    if (rootCleanup.alive) {
      cleanupFailures.push(`process ${rootPid} remained alive`)
    }
    // Why: a failing startup can still finish writing child markers while the
    // PTY close settles. Stop each parent before harvesting its child marker.
    await delay(100)
    agentPid = recoverMarkerPid(agentPidPath, agentPid)
    const agentCleanup = await killExactWindowsPid(agentPid)
    processCleanup.push(agentCleanup)
    if (agentCleanup.alive) {
      cleanupFailures.push(`process ${agentPid} remained alive`)
    }
    await delay(100)
    launcherPid = recoverMarkerPid(launcherPidPath, launcherPid)
    const launcherCleanup = await killExactWindowsPid(launcherPid)
    processCleanup.push(launcherCleanup)
    if (launcherCleanup.alive) {
      cleanupFailures.push(`process ${launcherPid} remained alive`)
    }
    await delay(100)
    lockHolderPid = recoverMarkerPid(lockHolderPidPath, lockHolderPid)
    const lockHolderCleanup = await killExactWindowsPid(lockHolderPid)
    processCleanup.push(lockHolderCleanup)
    if (lockHolderCleanup.alive) {
      cleanupFailures.push(`process ${lockHolderPid} remained alive`)
    }
    let worktreeCleanup: Awaited<ReturnType<typeof cleanupCreatedWorktree>> | null = null
    if (created) {
      worktreeCleanup = await cleanupCreatedWorktree(orcaPage, created)
      if (worktreeCleanup.exists) {
        cleanupFailures.push(`worktree path remained: ${created.path}`)
      }
      if (worktreeCleanup.listed) {
        cleanupFailures.push(`worktree store row remained: ${created.id}`)
      }
      if (worktreeCleanup.registered) {
        cleanupFailures.push(`Git worktree registration remained: ${created.path}`)
      }
    }
    evidence.cleanup = {
      processCleanup,
      worktreeCleanup,
      failures: cleanupFailures
    }
    const evidencePath = testInfo.outputPath('windows-agent-worktree-deletion-evidence.json')
    writeFileSync(evidencePath, JSON.stringify(evidence, null, 2))
    await testInfo.attach('windows-agent-worktree-deletion-evidence.json', {
      path: evidencePath,
      contentType: 'application/json'
    })
    if (cleanupFailures.length === 0) {
      rmSync(stage, { recursive: true, force: true })
    }
  }
  expect(cleanupFailures, `Windows E2E cleanup failed: ${cleanupFailures.join('; ')}`).toEqual([])
})

test('plain Windows terminal close preserves an intentionally detached child', async ({
  orcaPage
}) => {
  test.skip(process.platform !== 'win32', 'requires native Windows ConPTY')

  const stage = mkdtempSync(join(tmpdir(), 'orca-windows-plain-detached-'))
  const markerPath = join(stage, 'child.pid')
  const rootPidPath = join(stage, 'root.pid')
  const spawnerPath = join(stage, 'spawn-detached.cjs')
  writeFileSync(
    spawnerPath,
    [
      "const { spawn } = require('node:child_process')",
      "const { writeFileSync } = require('node:fs')",
      "const child = spawn(process.execPath, ['-e', 'setInterval(() => {}, 1000)'], { detached: true, stdio: 'ignore', windowsHide: true })",
      'writeFileSync(process.argv[2], String(child.pid))',
      'child.unref()',
      ''
    ].join('\n')
  )
  const powershellPath = join(
    process.env.SystemRoot ?? 'C:\\Windows',
    'System32',
    'WindowsPowerShell',
    'v1.0',
    'powershell.exe'
  )
  let childPid = 0
  let rootPid = 0
  let ptyId = ''
  let cleanupFailure: string | null = null

  try {
    await waitForSessionReady(orcaPage)
    const worktreeId = await waitForActiveWorktree(orcaPage)
    const command = `[IO.File]::WriteAllText(${quotePowerShellArg(rootPidPath)}, [string]$PID); & ${quotePowerShellArg(process.execPath)} ${quotePowerShellArg(spawnerPath)} ${quotePowerShellArg(markerPath)}`
    ptyId = await orcaPage.evaluate(
      async ({ command: startupCommand, cwd, worktreeId: id, shellOverride }) => {
        const result = await window.api.pty.spawn({
          cols: 120,
          rows: 40,
          cwd,
          command: startupCommand,
          shellOverride,
          worktreeId: id
        })
        return result.id
      },
      { command, cwd: stage, worktreeId, shellOverride: powershellPath }
    )
    await expect.poll(() => existsSync(markerPath), { timeout: 20_000 }).toBe(true)
    childPid = readMarkerPid(markerPath)
    expect(isProcessAlive(childPid)).toBe(true)

    await orcaPage.evaluate((id) => window.api.pty.kill(id), ptyId)
    await expect.poll(() => orcaPage.evaluate((id) => window.api.pty.hasPty(id), ptyId)).toBe(false)

    await requireProcessAliveFor(childPid, 1_500)
  } finally {
    rootPid = recoverMarkerPid(rootPidPath, rootPid)
    childPid = recoverMarkerPid(markerPath, childPid)
    if (ptyId) {
      await orcaPage.evaluate((id) => window.api.pty.kill(id), ptyId).catch(() => undefined)
    }
    rootPid = recoverMarkerPid(rootPidPath, rootPid)
    const rootCleanup = await killExactWindowsPid(rootPid)
    await delay(100)
    childPid = recoverMarkerPid(markerPath, childPid)
    const cleanup = await killExactWindowsPid(childPid)
    if (rootCleanup.alive || cleanup.alive) {
      cleanupFailure = `Plain-terminal E2E cleanup left process(es) alive: root=${rootPid}:${rootCleanup.alive}, child=${childPid}:${cleanup.alive}`
    } else {
      rmSync(stage, { recursive: true, force: true })
    }
  }
  expect(cleanupFailure, cleanupFailure ?? undefined).toBeNull()
})
