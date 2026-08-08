import type { ElectronApplication, Page } from '@stablyai/playwright-test'
import type { SshRemotePtyLease } from '../../src/shared/ssh-types'
import { toAppSshPtyId } from '../../src/shared/ssh-pty-id'
import { expect, test } from './helpers/orca-app'
import { connectDockerSshRelayTarget } from './helpers/docker-ssh-relay-connection'
import { readDockerSshRelayDaemonSnapshots } from './helpers/docker-ssh-relay-processes'
import {
  cleanupDockerSshRelayTarget,
  execDockerSshRelayTargetCommand,
  shellQuote,
  startDockerSshRelayTarget,
  writeDockerSshRelayTargetFile,
  type DockerSshRelayTarget
} from './helpers/docker-ssh-relay-target'
import {
  attachDockerSshTerminalAuthorityLogs,
  DOCKER_SSH_TERMINAL_AUTHORITY_AUDIT_FILE,
  DOCKER_SSH_TERMINAL_AUTHORITY_AUDIT_SCRIPT,
  DOCKER_SSH_TERMINAL_AUTHORITY_REPLAY_COMPLETE,
  DOCKER_SSH_TERMINAL_AUTHORITY_REPLAY_LINE_COUNT,
  dockerSshTerminalAuthorityAuditProgram,
  dockerSshTerminalAuthorityInputFrame,
  readDockerSshAuditFile,
  readDockerSshTerminalAuthorityAuditPid,
  readDockerSshTerminalAuthorityMarker,
  readPersistedDockerSshTerminalAuthorityLease
} from './helpers/docker-ssh-terminal-authority'
import { createRestartSession } from './helpers/orca-restart'
import { waitForActiveWorktree, waitForSessionReady } from './helpers/store'
import {
  execInTerminal,
  getTerminalContent,
  readPaneIdentitySnapshot,
  sendToTerminal,
  waitForActivePanePtyId,
  waitForActiveTerminalManager,
  waitForTerminalOutput,
  type PaneIdentitySnapshot
} from './helpers/terminal'

const RUN_DOCKER_SSH = process.env.ORCA_E2E_SSH_DOCKER === '1'
const AUTHORITY_BUDGET_MS = 90_000

type AuthorityRestartProof = Readonly<{
  ptyId: string
  pane: PaneIdentitySnapshot
  stablePaneId: string
  lease: SshRemotePtyLease
}>

async function waitForConnectedTarget(page: Page, targetId: string): Promise<void> {
  await expect
    .poll(
      () =>
        page.evaluate(
          (targetId) =>
            window.__store?.getState().sshConnectionStates.get(targetId)?.status ?? 'missing',
          targetId
        ),
      { timeout: AUTHORITY_BUDGET_MS, message: 'SSH target did not reconnect after app relaunch' }
    )
    .toBe('connected')
}

async function captureAuthorityRestartProof(
  page: Page,
  targetId: string,
  userDataDir: string
): Promise<AuthorityRestartProof> {
  await waitForActiveTerminalManager(page, AUTHORITY_BUDGET_MS)
  const ptyId = await waitForActivePanePtyId(page, AUTHORITY_BUDGET_MS)
  let pane = await readPaneIdentitySnapshot(page)
  await expect
    .poll(
      async () => {
        pane = await readPaneIdentitySnapshot(page)
        return pane?.activeLeafId ?? null
      },
      { timeout: AUTHORITY_BUDGET_MS, message: 'SSH pane identity did not settle' }
    )
    .not.toBeNull()
  let lease = readPersistedDockerSshTerminalAuthorityLease(userDataDir, targetId)
  await expect
    .poll(
      () => {
        lease = readPersistedDockerSshTerminalAuthorityLease(userDataDir, targetId)
        return lease?.terminalSessionAuthorityAccess ?? null
      },
      { timeout: AUTHORITY_BUDGET_MS, message: 'SSH authority access was not durably leased' }
    )
    .not.toBeNull()
  if (!pane?.activeLeafId || !lease?.terminalSessionAuthorityAccess) {
    throw new Error('SSH authority restart proof was incomplete')
  }
  const activePane = pane.panes.find((candidate) => candidate.leafId === pane!.activeLeafId)
  if (!activePane) {
    throw new Error('SSH authority pane disappeared while capturing its identity')
  }
  expect(ptyId).toBe(toAppSshPtyId(targetId, lease.ptyId))
  expect(lease.terminalSessionAuthorityAccess.binding.physicalPtyId).toBe(lease.ptyId)
  expect(lease.terminalSessionAuthorityAccess.binding.ptyIncarnationId).toBe(lease.incarnationId)
  return Object.freeze({ ptyId, pane, stablePaneId: activePane.stablePaneId, lease })
}

async function waitForAuthorityPid(target: DockerSshRelayTarget): Promise<number> {
  let pid: number | null = null
  await expect
    .poll(
      () => {
        const authorities = readDockerSshRelayDaemonSnapshots(target).filter(
          (snapshot) => snapshot.role === 'terminal-authority'
        )
        pid = authorities.length === 1 ? authorities[0]!.relayPid : null
        return pid
      },
      { timeout: AUTHORITY_BUDGET_MS, message: 'Remote terminal authority did not converge' }
    )
    .not.toBeNull()
  if (!pid) {
    throw new Error('Remote terminal authority PID disappeared')
  }
  return pid
}

function assertSameAuthorityIdentity(
  before: AuthorityRestartProof,
  after: AuthorityRestartProof
): void {
  expect(after.ptyId).toBe(before.ptyId)
  expect(after.pane.tabId).toBe(before.pane.tabId)
  expect(after.pane.activeLeafId).toBe(before.pane.activeLeafId)
  expect(after.stablePaneId).toBe(before.stablePaneId)
  expect(after.pane.ptyIdsByLeafId).toEqual(before.pane.ptyIdsByLeafId)
  expect(after.lease.ptyId).toBe(before.lease.ptyId)
  expect(after.lease.incarnationId).toBe(before.lease.incarnationId)
  expect(after.lease.worktreeId).toBe(before.lease.worktreeId)
  expect(after.lease.tabId).toBe(before.lease.tabId)
  expect(after.lease.leafId).toBe(before.lease.leafId)
  expect(after.lease.paneGeneration).toBe(before.lease.paneGeneration)
  expect(after.lease.terminalSessionAuthorityAccess).toEqual(
    before.lease.terminalSessionAuthorityAccess
  )
}

function assertOrderedReplayExactlyOnce(content: string): void {
  let previousOffset = -1
  for (let index = 1; index <= DOCKER_SSH_TERMINAL_AUTHORITY_REPLAY_LINE_COUNT; index += 1) {
    const marker = `AUTHORITY_REPLAY_${String(index).padStart(2, '0')}`
    expect(content.split(marker)).toHaveLength(2)
    const offset = content.indexOf(marker)
    expect(offset).toBeGreaterThan(previousOffset)
    previousOffset = offset
  }
}

test.describe('Docker SSH terminal authority app restart', () => {
  test.skip(!RUN_DOCKER_SSH, 'Set ORCA_E2E_SSH_DOCKER=1 to run Docker SSH authority tests.')

  test('preserves exact authority, process, pane, replay, and input across relaunch', async () => {
    test.setTimeout(360_000)
    const testInfo = test.info()
    const restart = createRestartSession(testInfo)
    let target: DockerSshRelayTarget | null = null
    let firstApp: ElectronApplication | null = null
    let secondApp: ElectronApplication | null = null
    try {
      target = startDockerSshRelayTarget(testInfo, { maxSessions: 1 })
      writeDockerSshRelayTargetFile(
        target,
        DOCKER_SSH_TERMINAL_AUTHORITY_AUDIT_SCRIPT,
        dockerSshTerminalAuthorityAuditProgram()
      )
      const firstLaunch = await restart.launch()
      firstApp = firstLaunch.app
      await waitForSessionReady(firstLaunch.page)
      const remote = await connectDockerSshRelayTarget(firstLaunch.page, target, {
        relayGracePeriodSeconds: 300
      })
      await expect
        .poll(() => waitForActiveWorktree(firstLaunch.page), { timeout: AUTHORITY_BUDGET_MS })
        .toBe(remote.worktreeId)
      const before = await captureAuthorityRestartProof(
        firstLaunch.page,
        remote.targetId,
        restart.userDataDir
      )
      await execInTerminal(
        firstLaunch.page,
        before.ptyId,
        `node ${shellQuote(DOCKER_SSH_TERMINAL_AUTHORITY_AUDIT_SCRIPT)}`
      )
      await waitForTerminalOutput(
        firstLaunch.page,
        'AUTHORITY_AUDIT_READY',
        30_000,
        AUTHORITY_BUDGET_MS
      )
      const auditPid = readDockerSshTerminalAuthorityAuditPid(target)
      const authorityPid = await waitForAuthorityPid(target)
      const markerBefore = readDockerSshTerminalAuthorityMarker(target)
      expect(markerBefore?.ownerPid).toBe(authorityPid)

      await firstLaunch.page.evaluate(() => window.dispatchEvent(new Event('beforeunload')))
      await expect
        .poll(
          async () => {
            const persisted = await firstLaunch.page.evaluate(() => window.api.session.get())
            const lease = readPersistedDockerSshTerminalAuthorityLease(
              restart.userDataDir,
              remote.targetId
            )
            return {
              active: persisted.activeConnectionIdsAtShutdown?.includes(remote.targetId) === true,
              access: lease?.terminalSessionAuthorityAccess ?? null
            }
          },
          { timeout: 15_000, message: 'SSH authority state was not durable before app close' }
        )
        .toEqual({
          active: true,
          access: before.lease.terminalSessionAuthorityAccess
        })

      await restart.close(firstApp)
      firstApp = null
      expect(await waitForAuthorityPid(target)).toBe(authorityPid)
      expect(readDockerSshTerminalAuthorityAuditPid(target)).toBe(auditPid)
      execDockerSshRelayTargetCommand(
        target,
        `kill -USR2 ${auditPid} && test -r /proc/${auditPid}/cmdline`
      )
      await expect
        .poll(
          () => readDockerSshAuditFile(target!, DOCKER_SSH_TERMINAL_AUTHORITY_REPLAY_COMPLETE),
          { timeout: 30_000, message: 'Remote PTY did not emit restart replay output' }
        )
        .toContain('complete')

      const secondLaunch = await restart.launch()
      secondApp = secondLaunch.app
      await waitForSessionReady(secondLaunch.page, AUTHORITY_BUDGET_MS)
      await expect
        .poll(() => waitForActiveWorktree(secondLaunch.page), { timeout: AUTHORITY_BUDGET_MS })
        .toBe(remote.worktreeId)
      await waitForConnectedTarget(secondLaunch.page, remote.targetId)
      const after = await captureAuthorityRestartProof(
        secondLaunch.page,
        remote.targetId,
        restart.userDataDir
      )
      assertSameAuthorityIdentity(before, after)
      expect(await waitForAuthorityPid(target)).toBe(authorityPid)
      expect(readDockerSshTerminalAuthorityAuditPid(target)).toBe(auditPid)
      expect(readDockerSshTerminalAuthorityMarker(target)).toEqual(markerBefore)

      await waitForTerminalOutput(
        secondLaunch.page,
        `AUTHORITY_REPLAY_${DOCKER_SSH_TERMINAL_AUTHORITY_REPLAY_LINE_COUNT}`,
        60_000,
        100_000
      )
      assertOrderedReplayExactlyOnce(await getTerminalContent(secondLaunch.page, 100_000))

      const postRestartInput = `after-main-relaunch-${Date.now()}`
      const encodedPostRestartInput = Buffer.from(postRestartInput).toString('base64url')
      await sendToTerminal(
        secondLaunch.page,
        after.ptyId,
        dockerSshTerminalAuthorityInputFrame(postRestartInput)
      )
      await waitForTerminalOutput(
        secondLaunch.page,
        `AUTHORITY_INPUT_ACK_${encodedPostRestartInput}`,
        30_000,
        AUTHORITY_BUDGET_MS
      )
      expect(
        readDockerSshAuditFile(target, DOCKER_SSH_TERMINAL_AUTHORITY_AUDIT_FILE).split(
          `INPUT:${encodedPostRestartInput}`
        )
      ).toHaveLength(2)
      expect(readDockerSshTerminalAuthorityAuditPid(target)).toBe(auditPid)
    } finally {
      if (secondApp) {
        await restart.close(secondApp)
      }
      if (firstApp) {
        await restart.close(firstApp)
      }
      await restart.dispose()
      await attachDockerSshTerminalAuthorityLogs(testInfo, target)
      cleanupDockerSshRelayTarget(target)
    }
  })
})
