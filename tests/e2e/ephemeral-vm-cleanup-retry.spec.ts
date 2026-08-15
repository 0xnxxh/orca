import { execFileSync, spawnSync } from 'node:child_process'
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import type { Page } from '@stablyai/playwright-test'
import { test, expect } from './helpers/orca-app'
import { encodePairingOffer, PAIRING_OFFER_VERSION } from '../../src/shared/pairing'

test.use({ seedTestRepo: false })

test('shows interrupted hidden SSH cleanup as retryable', async ({ electronApp, orcaPage }) => {
  const userDataPath = await electronApp.evaluate(({ app }) => app.getPath('userData'))
  writeFileSync(
    path.join(userDataPath, 'orca-ephemeral-vm-runtimes.json'),
    JSON.stringify({
      version: 1,
      runtimes: [
        {
          id: 'runtime-cleanup-retry',
          recipeId: 'cloud-sandbox',
          repoId: 'repo-1',
          workspaceName: 'Interrupted cleanup',
          status: 'cleaned',
          cleanupStatus: 'succeeded',
          connectionMode: 'ssh',
          sshTargetId: 'runtime-ssh-cleanup-retry',
          createdAt: 1,
          updatedAt: 1,
          recipeResult: {
            schemaVersion: 1,
            connection: {
              type: 'ssh',
              projectRoot: '/workspace/repo',
              target: {
                label: 'Cloud VM',
                host: 'vm.example.com',
                port: 22,
                username: 'developer'
              }
            }
          }
        }
      ]
    })
  )

  await orcaPage.evaluate(() => {
    const state = window.__store!.getState()
    state.openSettingsTarget({ pane: 'servers', repoId: null })
    state.openSettingsPage()
  })
  await expect(orcaPage.getByPlaceholder('Search settings')).toBeVisible()
  await orcaPage
    .getByRole('group', { name: 'Remote server workflow' })
    .getByRole('button', { name: /^Cloud VM/ })
    .click()

  const runtimes = orcaPage.locator('[data-settings-section="temporary-vm-runtimes"]')
  await expect(runtimes.getByText('Interrupted cleanup')).toBeVisible()
  await expect(runtimes.getByText('Cleanup failed')).toBeVisible()
  await expect(runtimes.getByRole('button', { name: 'Retry cleanup' })).toBeVisible()
})

test('stops long-running cleanup and keeps it retryable', async ({ electronApp, orcaPage }) => {
  const repoPath = mkdtempSync(path.join(tmpdir(), 'orca-cleanup-stop-'))
  const destroyPath = path.join(repoPath, 'destroy.js')
  const destroyStartedPath = path.join(repoPath, 'destroy-started.txt')
  try {
    writeFileSync(
      destroyPath,
      `require('fs').writeFileSync(${JSON.stringify(destroyStartedPath)}, 'yes'); setInterval(() => {}, 1000)`
    )
    execFileSync('git', ['init'], { cwd: repoPath })
    execFileSync('git', ['config', 'user.email', 'e2e@test.local'], { cwd: repoPath })
    execFileSync('git', ['config', 'user.name', 'Orca E2E'], { cwd: repoPath })
    writeFileSync(path.join(repoPath, 'README.md'), 'cleanup stop fixture\n')
    execFileSync('git', ['add', '.'], { cwd: repoPath })
    execFileSync('git', ['commit', '-m', 'seed'], { cwd: repoPath })

    const repoId = await orcaPage.evaluate(async (repo) => {
      const result = await window.api.repos.add({ path: repo })
      if ('error' in result) {
        throw new Error(result.error)
      }
      return result.repo.id
    }, repoPath)
    const userDataPath = await electronApp.evaluate(({ app }) => app.getPath('userData'))
    writeFileSync(
      path.join(userDataPath, 'orca-ephemeral-vm-runtimes.json'),
      JSON.stringify({
        version: 1,
        runtimes: [
          {
            id: 'runtime-cleanup-stop',
            recipeId: 'cloud-sandbox',
            recipe: {
              id: 'cloud-sandbox',
              name: 'Cloud Sandbox',
              create: 'unused',
              destroy: `${JSON.stringify(process.execPath)} ${JSON.stringify(destroyPath)}`
            },
            repoId,
            workspaceName: 'Long cleanup',
            status: 'running',
            cleanupStatus: 'not_started',
            createdAt: 1,
            updatedAt: 1,
            recipeResult: {
              schemaVersion: 1,
              connection: {
                type: 'ssh',
                projectRoot: '/workspace/repo',
                target: {
                  label: 'Cloud VM',
                  host: 'vm.example.com',
                  port: 22,
                  username: 'developer'
                }
              }
            }
          }
        ]
      })
    )

    await openCloudVmRuntimes(orcaPage)
    const runtimes = orcaPage.locator('[data-settings-section="temporary-vm-runtimes"]')
    await expect(runtimes.getByText('Long cleanup')).toBeVisible()
    await runtimes.getByRole('button', { name: 'Cleanup', exact: true }).click()
    await expect(runtimes.getByRole('button', { name: 'Stop cleanup' })).toBeVisible()
    await expect.poll(() => existsSync(destroyStartedPath)).toBe(true)

    await runtimes.getByRole('button', { name: 'Stop cleanup' }).click()
    const dialog = orcaPage.getByRole('dialog', { name: 'Stop cleanup?' })
    await expect(dialog).toContainText('The VM may remain running and incur charges.')
    await dialog.getByRole('button', { name: 'Stop cleanup' }).click()

    await expect(dialog).toBeHidden()
    await expect(runtimes.getByText('Cleanup stopped', { exact: true })).toBeVisible()
    await expect(runtimes.getByRole('button', { name: 'Retry cleanup' })).toBeVisible()
    await expect(orcaPage.getByText('Cleanup stopped by user.')).toBeVisible()

    writeFileSync(destroyPath, "process.stdin.resume(); process.stdin.on('end', () => {})")
    await runtimes.getByRole('button', { name: 'Retry cleanup' }).click()
    await expect(runtimes.getByText('Long cleanup')).toBeHidden()
    await expect
      .poll(() =>
        orcaPage.evaluate(async () => {
          const runtime = (await window.api.ephemeralVm.listRuntimes()).find(
            (entry) => entry.id === 'runtime-cleanup-stop'
          )
          return runtime?.cleanupStatus
        })
      )
      .toBe('succeeded')
  } finally {
    rmSync(repoPath, { recursive: true, force: true })
  }
})

test('vm doctor waits for a closed destroy shell process group', () => {
  test.skip(process.platform === 'win32', 'POSIX process-group ownership')
  const repoPath = mkdtempSync(path.join(tmpdir(), 'orca-vm-doctor-cleanup-'))
  const startPath = path.join(repoPath, 'start.js')
  const destroyPath = path.join(repoPath, 'destroy.js')
  const descendantPidPath = path.join(repoPath, 'descendant.pid')
  let descendantPid = 0
  try {
    const pairingCode = encodePairingOffer({
      v: PAIRING_OFFER_VERSION,
      endpoint: 'ws://sandbox.example.com:6767',
      deviceToken: 'token',
      publicKeyB64: 'public-key'
    })
    writeFileSync(
      startPath,
      `console.log(${JSON.stringify(JSON.stringify({ schemaVersion: 1, pairingCode, projectRoot: '/workspace/repo' }))})`
    )
    writeFileSync(
      destroyPath,
      [
        "const { spawn } = require('node:child_process')",
        "const { writeFileSync } = require('node:fs')",
        "const child = spawn(process.execPath, ['-e', 'setTimeout(() => {}, 300)'], { stdio: 'ignore' })",
        `writeFileSync(${JSON.stringify(descendantPidPath)}, String(child.pid))`
      ].join('\n')
    )
    writeFileSync(
      path.join(repoPath, 'orca.yaml'),
      [
        'environmentRecipes:',
        '  - id: cloud-sandbox',
        '    name: Cloud Sandbox',
        `    create: ${JSON.stringify(`${process.execPath} ${startPath}`)}`,
        `    destroy: ${JSON.stringify(`${process.execPath} ${destroyPath}`)}`
      ].join('\n')
    )

    const output = execFileSync(
      process.execPath,
      [
        path.join(process.cwd(), 'out', 'cli', 'index.js'),
        'vm',
        'recipe',
        'doctor',
        'cloud-sandbox',
        '--repo-path',
        repoPath,
        '--provision',
        '--json'
      ],
      { encoding: 'utf8', timeout: 5_000 }
    )
    descendantPid = Number(readFileSync(descendantPidPath, 'utf8'))
    const result = JSON.parse(output) as {
      ok: boolean
      checks: { id: string; status: string }[]
    }
    expect(result.ok).toBe(true)
    expect(result.checks).toContainEqual(
      expect.objectContaining({ id: 'recipe.destroy.run', status: 'pass' })
    )
    expect(isProcessAlive(descendantPid)).toBe(false)
  } finally {
    if (isProcessAlive(descendantPid)) {
      process.kill(descendantPid, 'SIGKILL')
    }
    rmSync(repoPath, { recursive: true, force: true })
  }
})

test('vm doctor reports its deadline after the provider tree stops', () => {
  test.skip(process.platform === 'win32', 'POSIX process-group ownership')
  const repoPath = mkdtempSync(path.join(tmpdir(), 'orca-vm-doctor-deadline-'))
  const startPath = path.join(repoPath, 'start.js')
  const destroyPath = path.join(repoPath, 'destroy.js')
  const preloadPath = path.join(repoPath, 'short-deadline.cjs')
  try {
    const pairingCode = encodePairingOffer({
      v: PAIRING_OFFER_VERSION,
      endpoint: 'ws://sandbox.example.com:6767',
      deviceToken: 'token',
      publicKeyB64: 'public-key'
    })
    writeFileSync(
      startPath,
      `console.log(${JSON.stringify(JSON.stringify({ schemaVersion: 1, pairingCode, projectRoot: '/workspace/repo' }))})`
    )
    writeFileSync(destroyPath, "process.on('SIGTERM', () => {}); setInterval(() => {}, 1000)")
    writeFileSync(
      preloadPath,
      [
        'const realSetTimeout = global.setTimeout',
        'const realKill = process.kill.bind(process)',
        'let forcedAt = 0',
        'global.setTimeout = (callback, delay, ...args) =>',
        '  realSetTimeout(callback, delay === 295000 ? 50 : delay, ...args)',
        'process.kill = (pid, signal) => {',
        "  if (pid < 0 && signal === 'SIGKILL') forcedAt = Date.now()",
        '  if (pid < 0 && signal === 0 && forcedAt && Date.now() - forcedAt < 200) return true',
        '  return realKill(pid, signal)',
        '}'
      ].join('\n')
    )
    writeFileSync(
      path.join(repoPath, 'orca.yaml'),
      [
        'environmentRecipes:',
        '  - id: cloud-sandbox',
        '    name: Cloud Sandbox',
        `    create: ${JSON.stringify(`${process.execPath} ${startPath}`)}`,
        `    destroy: ${JSON.stringify(`${process.execPath} ${destroyPath}`)}`
      ].join('\n')
    )

    const execution = spawnSync(
      process.execPath,
      [
        '--require',
        preloadPath,
        path.join(process.cwd(), 'out', 'cli', 'index.js'),
        'vm',
        'recipe',
        'doctor',
        'cloud-sandbox',
        '--repo-path',
        repoPath,
        '--provision',
        '--json'
      ],
      { encoding: 'utf8', timeout: 5_000 }
    )
    const result = JSON.parse(execution.stdout) as {
      ok: boolean
      checks: { id: string; status: string; message: string }[]
    }
    expect(execution.status).toBe(1)
    expect(result.ok).toBe(false)
    expect(result.checks).toContainEqual(
      expect.objectContaining({
        id: 'recipe.destroy.run',
        status: 'fail',
        message: expect.stringContaining('5-minute deadline')
      })
    )
  } finally {
    rmSync(repoPath, { recursive: true, force: true })
  }
})

async function openCloudVmRuntimes(page: Page): Promise<void> {
  await page.evaluate(() => {
    const state = window.__store!.getState()
    state.openSettingsTarget({ pane: 'servers', repoId: null })
    state.openSettingsPage()
  })
  await expect(page.getByPlaceholder('Search settings')).toBeVisible()
  await page
    .getByRole('group', { name: 'Remote server workflow' })
    .getByRole('button', { name: /^Cloud VM/ })
    .click()
}

function isProcessAlive(pid: number): boolean {
  if (!pid) {
    return false
  }
  try {
    process.kill(pid, 0)
    return true
  } catch {
    return false
  }
}
