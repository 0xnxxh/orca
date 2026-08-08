import type { Page } from '@stablyai/playwright-test'
import { writeFileSync } from 'node:fs'
import { expect, test } from './helpers/orca-app'
import { ensureTerminalVisible, waitForActiveWorktree, waitForSessionReady } from './helpers/store'
import {
  execInTerminal,
  getTerminalContent,
  readPaneIdentitySnapshot,
  sendToTerminal,
  waitForActivePanePtyId,
  waitForActiveTerminalManager,
  waitForTerminalOutput
} from './helpers/terminal'
import {
  connectDockerSshRelayTarget,
  reconnectDisconnectedDockerSshRelayTarget,
  reconnectDockerSshRelayTarget
} from './helpers/docker-ssh-relay-connection'
import {
  activateConnectedDockerSshRelayTarget,
  connectDockerSshAuthorityClientsConcurrently
} from './helpers/docker-ssh-authority-clients'
import {
  readDockerSshRelayDaemonSnapshots,
  type DockerSshRelayDaemonSnapshot
} from './helpers/docker-ssh-relay-processes'
import { signalDockerSshRelayDaemon } from './helpers/docker-ssh-relay-daemon-signal'
import {
  blockDockerSshRelayReconnect,
  cleanupDockerSshRelayTarget,
  execDockerSshRelayTargetCommand,
  restoreDockerSshRelayReconnect,
  shellQuote,
  startDockerSshRelayTarget,
  writeDockerSshRelayTargetFile,
  type DockerSshRelayTarget
} from './helpers/docker-ssh-relay-target'
import {
  attachDockerSshTerminalAuthorityLogs,
  DOCKER_SSH_INCOMPATIBLE_AUTHORITY_REVISION,
  DOCKER_SSH_TERMINAL_AUTHORITY_AUDIT_FILE,
  DOCKER_SSH_TERMINAL_AUTHORITY_AUDIT_SCRIPT,
  DOCKER_SSH_TERMINAL_AUTHORITY_REPLAY_COMPLETE,
  DOCKER_SSH_TERMINAL_AUTHORITY_REPLAY_LINE_COUNT,
  dockerSshTerminalAuthorityAuditProgram,
  dockerSshTerminalAuthorityInputFrame,
  installDockerSshTerminalBindingTransitionProbe,
  installDockerSshIncompatibleTerminalAuthorityMarker,
  readDockerSshAuditFile,
  readDockerSshTerminalAuthorityMarker
} from './helpers/docker-ssh-terminal-authority'
import { dropDockerSshClientSessions } from './ssh-codex-reconnect-replay-driver'

const RUN_DOCKER_SSH = process.env.ORCA_E2E_SSH_DOCKER === '1'
const CONNECTION_BUDGET_MS = 90_000
const AUTHORITY_BUDGET_MS = 90_000

type RelayTopology = {
  authority: DockerSshRelayDaemonSnapshot
  control: DockerSshRelayDaemonSnapshot
}

async function attachTerminalDeliveryDiagnostics(
  testInfo: Parameters<typeof startDockerSshRelayTarget>[0],
  page: Page,
  targetId: string,
  ptyId: string
): Promise<void> {
  let diagnostics: unknown
  try {
    diagnostics = await page.evaluate(
      async ({ targetId, ptyId }) => {
        const debugWindow = window as unknown as {
          __orcaTerminalFreezeReport?: () => Promise<unknown>
          __terminalPtyOutputDebug?: { snapshot: () => unknown }
          __ptyConnectDiag?: string[]
          __sshAuthorityBindingProbe?: { entries: unknown[] }
        }
        const state = window.__store?.getState()
        const listedSessions = await window.api.pty
          .listSessions()
          .catch((error) => ({ error: error instanceof Error ? error.message : String(error) }))
        const paneManagers = [...(window.__paneManagers?.entries() ?? [])].map(
          ([tabId, manager]) => ({
            tabId,
            activePaneId: manager.getActivePane?.()?.id ?? null,
            panes: (manager.getPanes?.() ?? []).map((pane) => ({
              paneId: pane.id,
              leafId: pane.leafId ?? null,
              ptyId: pane.container?.dataset?.ptyId ?? null,
              recoveryState: pane.container?.dataset?.ptyRecoveryState ?? null,
              serialized: pane.serializeAddon?.serialize?.() ?? '',
              cols: pane.terminal?.cols ?? null,
              rows: pane.terminal?.rows ?? null
            }))
          })
        )
        return {
          connection: state?.sshConnectionStates.get(targetId) ?? null,
          hasPty: await window.api.pty.hasPty(ptyId),
          listedSessions,
          mainSnapshot: await window.api.pty.getMainBufferSnapshot(ptyId),
          freezeReport: await debugWindow.__orcaTerminalFreezeReport?.(),
          outputDebug: debugWindow.__terminalPtyOutputDebug?.snapshot() ?? null,
          ptyConnectDiag: debugWindow.__ptyConnectDiag ?? [],
          bindingTransitions: debugWindow.__sshAuthorityBindingProbe?.entries ?? [],
          rendererBinding: {
            activeWorktreeId: state?.activeWorktreeId ?? null,
            activeTabId: state?.activeTabId ?? null,
            activeTabType: state?.activeTabType ?? null,
            activeTabIdByWorktree: state?.activeTabIdByWorktree ?? null,
            ptyIdsByTabId: state?.ptyIdsByTabId ?? null,
            terminalLayoutsByTabId: state?.terminalLayoutsByTabId ?? null,
            directSshPaneRetryByTabId: state?.directSshPaneRetryByTabId ?? null,
            directSshLivePtyBindingByTabId: state?.directSshLivePtyBindingByTabId ?? null,
            paneManagers,
            domPtyIds: [...document.querySelectorAll<HTMLElement>('[data-pty-id]')].map(
              (element) => ({
                ptyId: element.dataset.ptyId ?? null,
                leafId: element.dataset.leafId ?? null,
                connected: element.isConnected
              })
            )
          }
        }
      },
      { targetId, ptyId }
    )
  } catch (error) {
    diagnostics = { captureError: error instanceof Error ? error.message : String(error) }
  }
  try {
    const diagnosticPath = testInfo.outputPath('terminal-delivery-diagnostics.json')
    writeFileSync(diagnosticPath, JSON.stringify(diagnostics, null, 2))
    await testInfo.attach('terminal-delivery-diagnostics', {
      path: diagnosticPath,
      contentType: 'application/json'
    })
  } catch {
    // The original terminal-output failure remains the oracle.
  }
}

async function waitForRelayTopology(
  target: DockerSshRelayTarget,
  expectedControlCount = 1
): Promise<RelayTopology> {
  let snapshots: DockerSshRelayDaemonSnapshot[] = []
  await expect
    .poll(
      () => {
        snapshots = readDockerSshRelayDaemonSnapshots(target)
        return {
          authorities: snapshots.filter((entry) => entry.role === 'terminal-authority').length,
          controls: snapshots.filter((entry) => entry.role === 'control-adapter').length,
          legacy: snapshots.filter((entry) => entry.role === 'legacy-combined').length
        }
      },
      { timeout: AUTHORITY_BUDGET_MS, message: 'SSH relay roles did not converge' }
    )
    .toEqual({ authorities: 1, controls: expectedControlCount, legacy: 0 })
  return {
    authority: snapshots.find((entry) => entry.role === 'terminal-authority')!,
    control: snapshots.find((entry) => entry.role === 'control-adapter')!
  }
}

async function waitForAuthorityRevision(
  target: DockerSshRelayTarget,
  revision: number
): Promise<NonNullable<ReturnType<typeof readDockerSshTerminalAuthorityMarker>>> {
  let marker = readDockerSshTerminalAuthorityMarker(target)
  await expect
    .poll(
      () => {
        marker = readDockerSshTerminalAuthorityMarker(target)
        return marker?.revision ?? null
      },
      { timeout: AUTHORITY_BUDGET_MS, message: `Authority revision ${revision} was not published` }
    )
    .toBe(revision)
  if (!marker) {
    throw new Error('Terminal authority marker disappeared after revision barrier')
  }
  return marker
}

async function installConnectionCycleProbe(page: Page, targetId: string): Promise<void> {
  await page.evaluate((targetId) => {
    const holder = window as unknown as {
      __sshAuthorityCycleProbe?: { statuses: string[]; dispose: () => void }
    }
    holder.__sshAuthorityCycleProbe?.dispose()
    const store = window.__store
    if (!store) {
      throw new Error('Store unavailable')
    }
    const statuses = [store.getState().sshConnectionStates.get(targetId)?.status ?? 'missing']
    const dispose = store.subscribe((state, previous) => {
      const nextStatus = state.sshConnectionStates.get(targetId)?.status ?? 'missing'
      const previousStatus = previous.sshConnectionStates.get(targetId)?.status ?? 'missing'
      if (nextStatus !== previousStatus) {
        statuses.push(nextStatus)
      }
    })
    holder.__sshAuthorityCycleProbe = { statuses, dispose }
  }, targetId)
}

async function waitForConnectionCycle(page: Page): Promise<string[]> {
  let statuses: string[] = []
  await expect
    .poll(
      async () => {
        statuses = await page.evaluate(
          () =>
            (
              window as unknown as {
                __sshAuthorityCycleProbe?: { statuses: string[] }
              }
            ).__sshAuthorityCycleProbe?.statuses ?? []
        )
        return statuses.some((status) => status !== 'connected') && statuses.at(-1) === 'connected'
      },
      { timeout: CONNECTION_BUDGET_MS, message: 'SSH connection did not fence and reconnect' }
    )
    .toBe(true)
  return statuses
}

async function waitForPtyAvailable(page: Page, ptyId: string): Promise<void> {
  await expect
    .poll(
      () =>
        page.evaluate(async (id) => {
          const hasPty = await window.api.pty.hasPty(id)
          if (!hasPty) {
            return false
          }
          // Main reattachment commits before the generation-fenced renderer remount binds its pane.
          return [...(window.__paneManagers?.values() ?? [])].some((manager) =>
            manager.getPanes().some((pane) => pane.container.dataset.ptyId === id)
          )
        }, ptyId),
      {
        timeout: CONNECTION_BUDGET_MS,
        message: `SSH PTY ${ptyId} was not re-admitted and rebound in the renderer`
      }
    )
    .toBe(true)
}

test.describe('Docker SSH terminal authority', () => {
  test.skip(!RUN_DOCKER_SSH, 'Set ORCA_E2E_SSH_DOCKER=1 to run Docker SSH authority tests.')

  test('preserves the exact PTY across transport and control reconnects', async ({
    orcaPage
  }, testInfo) => {
    test.slow()
    let target: DockerSshRelayTarget | null = null
    let reconnectBlocked = false
    try {
      target = startDockerSshRelayTarget(testInfo, { maxSessions: 1 })
      writeDockerSshRelayTargetFile(
        target,
        DOCKER_SSH_TERMINAL_AUTHORITY_AUDIT_SCRIPT,
        dockerSshTerminalAuthorityAuditProgram()
      )
      await waitForSessionReady(orcaPage)
      await waitForActiveWorktree(orcaPage)
      const remote = await connectDockerSshRelayTarget(orcaPage, target, {
        relayGracePeriodSeconds: 300
      })
      await ensureTerminalVisible(orcaPage, 45_000)
      await waitForActiveTerminalManager(orcaPage, 60_000)
      const ptyId = await waitForActivePanePtyId(orcaPage, 60_000)
      const paneBefore = await readPaneIdentitySnapshot(orcaPage)
      const oldLeafId = paneBefore?.activeLeafId
      if (!paneBefore || !oldLeafId) {
        throw new Error('SSH terminal pane identity was unavailable')
      }
      await installDockerSshTerminalBindingTransitionProbe(orcaPage, {
        targetId: remote.targetId,
        tabId: paneBefore.tabId,
        leafId: oldLeafId
      })

      const firstTopology = await waitForRelayTopology(target)
      const firstMarker = await waitForAuthorityRevision(target, 1)
      expect(firstMarker.ownerPid).toBe(firstTopology.authority.relayPid)
      expect(firstMarker.ownerRelayDir).toBe(firstTopology.authority.relayDir)
      expect(firstMarker.ownerProcessToken).toBe(firstTopology.authority.authorityProcessToken)

      await execInTerminal(
        orcaPage,
        ptyId,
        `node ${shellQuote(DOCKER_SSH_TERMINAL_AUTHORITY_AUDIT_SCRIPT)}`
      )
      await waitForTerminalOutput(orcaPage, 'AUTHORITY_AUDIT_READY', 30_000, 80_000)

      await reconnectDockerSshRelayTarget(orcaPage, remote.targetId)
      await waitForPtyAvailable(orcaPage, ptyId)
      await sendToTerminal(orcaPage, ptyId, dockerSshTerminalAuthorityInputFrame('first-reconnect'))
      await waitForTerminalOutput(
        orcaPage,
        `AUTHORITY_INPUT_ACK_${Buffer.from('first-reconnect').toString('base64url')}`,
        30_000,
        80_000
      )
      const topologyAfterReconnect = await waitForRelayTopology(target)
      expect(topologyAfterReconnect.authority.relayPid).toBe(firstTopology.authority.relayPid)

      await installConnectionCycleProbe(orcaPage, remote.targetId)
      signalDockerSshRelayDaemon(target, topologyAfterReconnect.control, 'KILL')
      await waitForConnectionCycle(orcaPage)
      const topologyAfterControlKill = await waitForRelayTopology(target)
      expect(topologyAfterControlKill.control.relayPid).not.toBe(
        topologyAfterReconnect.control.relayPid
      )
      expect(topologyAfterControlKill.authority.relayPid).toBe(firstTopology.authority.relayPid)
      expect((await waitForAuthorityRevision(target, 1)).ownerPid).toBe(
        firstTopology.authority.relayPid
      )
      await waitForPtyAvailable(orcaPage, ptyId)
      await sendToTerminal(
        orcaPage,
        ptyId,
        dockerSshTerminalAuthorityInputFrame('after-control-kill')
      )
      await waitForTerminalOutput(
        orcaPage,
        `AUTHORITY_INPUT_ACK_${Buffer.from('after-control-kill').toString('base64url')}`,
        30_000,
        80_000
      )

      blockDockerSshRelayReconnect(target)
      reconnectBlocked = true
      dropDockerSshClientSessions(target)
      await expect
        .poll(
          () =>
            orcaPage.evaluate(
              (targetId) =>
                window.__store?.getState().sshConnectionStates.get(targetId)?.status ?? 'missing',
              remote.targetId
            ),
          { timeout: 30_000, message: 'SSH transport drop was not observed' }
        )
        .not.toBe('connected')
      execDockerSshRelayTargetCommand(
        target,
        `pid=$(awk -F: '/^START:/{print $2; exit}' ${shellQuote(DOCKER_SSH_TERMINAL_AUTHORITY_AUDIT_FILE)}); ` +
          'test -n "$pid" && kill -USR2 "$pid"'
      )
      await expect
        .poll(
          () => readDockerSshAuditFile(target!, DOCKER_SSH_TERMINAL_AUTHORITY_REPLAY_COMPLETE),
          {
            timeout: 30_000,
            message: 'Remote PTY did not produce the disconnected replay fixture'
          }
        )
        .toContain('complete')
      restoreDockerSshRelayReconnect(target)
      reconnectBlocked = false
      await reconnectDisconnectedDockerSshRelayTarget(orcaPage, remote.targetId)
      await waitForPtyAvailable(orcaPage, ptyId)
      try {
        await waitForTerminalOutput(orcaPage, 'AUTHORITY_REPLAY_32', 60_000, 100_000)
      } catch (error) {
        await attachTerminalDeliveryDiagnostics(testInfo, orcaPage, remote.targetId, ptyId)
        throw error
      }
      const replayed = await getTerminalContent(orcaPage, 100_000)
      for (let index = 1; index <= DOCKER_SSH_TERMINAL_AUTHORITY_REPLAY_LINE_COUNT; index += 1) {
        const marker = `AUTHORITY_REPLAY_${String(index).padStart(2, '0')}`
        expect(replayed.split(marker)).toHaveLength(2)
      }

      const postReplayInput = 'after-ordered-replay'
      const encodedPostReplayInput = Buffer.from(postReplayInput).toString('base64url')
      await sendToTerminal(orcaPage, ptyId, dockerSshTerminalAuthorityInputFrame(postReplayInput))
      await waitForTerminalOutput(
        orcaPage,
        `AUTHORITY_INPUT_ACK_${encodedPostReplayInput}`,
        30_000,
        80_000
      )
      expect(
        readDockerSshAuditFile(target, DOCKER_SSH_TERMINAL_AUTHORITY_AUDIT_FILE).split(
          `INPUT:${encodedPostReplayInput}`
        )
      ).toHaveLength(2)
      expect((await readPaneIdentitySnapshot(orcaPage))?.ptyIdsByLeafId[oldLeafId]).toBe(ptyId)
    } finally {
      if (target && reconnectBlocked) {
        restoreDockerSshRelayReconnect(target)
      }
      await attachDockerSshTerminalAuthorityLogs(testInfo, target)
      cleanupDockerSshRelayTarget(target)
    }
  })

  test('admits one authority owner under concurrent first-launch races', async ({
    orcaPage
  }, testInfo) => {
    test.slow()
    let target: DockerSshRelayTarget | null = null
    try {
      target = startDockerSshRelayTarget(testInfo)
      await waitForSessionReady(orcaPage)
      await waitForActiveWorktree(orcaPage)
      const clients = await connectDockerSshAuthorityClientsConcurrently(orcaPage, target, 2)
      expect(clients).toHaveLength(2)
      expect(new Set(clients.map((client) => client.targetId))).toHaveProperty('size', 2)
      const topology = await waitForRelayTopology(target, clients.length)
      const marker = await waitForAuthorityRevision(target, 1)
      expect(marker.ownerPid).toBe(topology.authority.relayPid)
      expect(marker.ownerProcessToken).toBe(topology.authority.authorityProcessToken)

      await activateConnectedDockerSshRelayTarget(orcaPage, clients[0]!.targetId)
      await ensureTerminalVisible(orcaPage, 45_000)
      await waitForActiveTerminalManager(orcaPage, 60_000)
      const ptyId = await waitForActivePanePtyId(orcaPage, 60_000)
      await execInTerminal(orcaPage, ptyId, 'echo CONCURRENT_AUTHORITY_WINNER_READY')
      await waitForTerminalOutput(orcaPage, 'CONCURRENT_AUTHORITY_WINNER_READY', 30_000, 80_000)
      expect((await waitForRelayTopology(target, clients.length)).authority.relayPid).toBe(
        topology.authority.relayPid
      )
    } finally {
      await attachDockerSshTerminalAuthorityLogs(testInfo, target)
      cleanupDockerSshRelayTarget(target)
    }
  })

  test('rejects an incompatible stable owner before terminal mutation', async ({
    orcaPage
  }, testInfo) => {
    test.slow()
    let target: DockerSshRelayTarget | null = null
    try {
      target = startDockerSshRelayTarget(testInfo, { maxSessions: 1 })
      installDockerSshIncompatibleTerminalAuthorityMarker(target)
      await waitForSessionReady(orcaPage)
      const result = await orcaPage.evaluate(async (target) => {
        const credentialUnsub = window.api.ssh.onCredentialRequest((request) => {
          void window.api.ssh.submitCredential({ requestId: request.requestId, value: null })
        })
        try {
          const added = await window.api.ssh.addTarget({
            target: {
              label: `Docker SSH Incompatible Authority ${Date.now()}`,
              host: target.host,
              port: target.port,
              username: 'root',
              identityFile: target.identityFile,
              identitiesOnly: true,
              relayGracePeriodSeconds: 300
            }
          })
          try {
            const state = await window.api.ssh.connect({ targetId: added.target.id })
            return { connected: state?.status === 'connected', error: '' }
          } catch (error) {
            return {
              connected: false,
              error: error instanceof Error ? error.message : String(error)
            }
          }
        } finally {
          credentialUnsub()
        }
      }, target)
      expect(result.connected).toBe(false)
      expect(result.error).toMatch(/incompatible protocol/i)
      const marker = readDockerSshTerminalAuthorityMarker(target)
      expect(marker?.revision).toBe(DOCKER_SSH_INCOMPATIBLE_AUTHORITY_REVISION)
      expect(marker?.ownerBuildId).toBe('incompatible-owner-build')
      expect(
        readDockerSshRelayDaemonSnapshots(target).filter(
          (entry) => entry.role === 'terminal-authority'
        )
      ).toEqual([])
    } finally {
      await attachDockerSshTerminalAuthorityLogs(testInfo, target)
      cleanupDockerSshRelayTarget(target)
    }
  })
})
