import { test, expect } from './helpers/orca-app'
import { ensureTerminalVisible, waitForActiveWorktree, waitForSessionReady } from './helpers/store'
import {
  execInTerminal,
  waitForActivePanePtyId,
  waitForActiveTerminalManager,
  waitForTerminalOutput
} from './helpers/terminal'
import {
  cleanupDockerSshRelayTarget,
  startDockerSshRelayTarget,
  type DockerSshRelayTarget
} from './helpers/docker-ssh-relay-target'
import {
  connectDockerSshRelayTarget,
  reconnectDockerSshRelayTarget
} from './helpers/docker-ssh-relay-connection'
import { openTerminalTabInActiveGroup } from './helpers/terminal-tab-open'

const RUN_DOCKER_SSH = process.env.ORCA_E2E_SSH_DOCKER === '1'

/**
 * An SSH reconnect destroys the terminal state behind a tab whose creation has not yet reached the
 * host, while the process it was running keeps going.
 *
 * The symptom is worse than a disappearing tab, because the two models disagree: the TAB BAR still
 * renders the tab, correctly titled, but the terminal slice holds only the older tab and no pane
 * manager exists for the newer one. So the user is left clicking a selected tab that will never
 * paint, with no error and no way to recover it, while `top` runs on untouched on the host.
 *
 * Mechanism:
 * - `remote-workspace-session-merge.ts:86-89` builds `tabsByWorktree` as
 *   `{...omitTargetWorktrees(current), ...remote}`. A local tab for the target worktree that is
 *   absent from the host snapshot has no surviving branch — it is simply not in the result.
 * - `remote-workspace-target-sync.ts` applies that host snapshot unconditionally once
 *   `revision > 0`, without pushing local state first.
 * - The upload that would have put the tab in the host list is DROPPED rather than deferred: the
 *   debounced session writer is gated on `!isRemoteWorkspaceSnapshotApplyInProgress()`, and
 *   `REMOTE_WORKSPACE_SNAPSHOT_WRITE_SUPPRESS_MS` is 1_000 after a snapshot apply. A tab created
 *   inside that window never gets written.
 *
 * Correlation observed across runs, which is what pinned the mechanism: host snapshot revision 1
 * (1 tab) always lost the pane; revision 2 (2 tabs) always kept it.
 *
 * PRE-EXISTING. None of remote-workspace-target-sync.ts, remote-workspace-session-merge.ts,
 * use-app-session-persistence.ts or remote-workspace-snapshot-apply.ts was touched by the branch
 * that added this spec.
 *
 * Marked fixme rather than deleted or worked around. Waiting for the upload would hide it, and a
 * user opening a tab right after a reconnect has no such signal to wait on either. The likely fix is
 * to push local state before applying a host snapshot rather than letting `revision > 0` win
 * unconditionally — a risky change in the session-sync protocol, deliberately not attempted here.
 */
test.describe('SSH reconnect tab destruction', () => {
  test.skip(!RUN_DOCKER_SSH, 'Set ORCA_E2E_SSH_DOCKER=1 to run the dockerized SSH relay tests')

  test.fixme('keeps a tab created right after a reconnect alive across the next one', async ({
    orcaPage
  }, testInfo) => {
    test.slow()
    let target: DockerSshRelayTarget | null = null
    try {
      target = startDockerSshRelayTarget(testInfo)
      await waitForSessionReady(orcaPage)
      await waitForActiveWorktree(orcaPage)
      const remote = await connectDockerSshRelayTarget(orcaPage, target)
      await ensureTerminalVisible(orcaPage, 45_000)
      await waitForActiveTerminalManager(orcaPage, 60_000)
      const ptyId = await waitForActivePanePtyId(orcaPage, 60_000)

      await reconnectDockerSshRelayTarget(orcaPage, remote.targetId)
      await waitForActiveTerminalManager(orcaPage, 60_000)
      await waitForActivePanePtyId(orcaPage, 60_000)

      // Immediately after the apply, i.e. inside the 1s suppression window, so the tab's creation
      // is dropped from the session write rather than deferred. This is the ordinary thing a user
      // does; the timing is not contrived.
      await openTerminalTabInActiveGroup(orcaPage)
      await waitForActiveTerminalManager(orcaPage, 60_000)
      const freshPtyId = await waitForActivePanePtyId(orcaPage, 60_000)
      expect(freshPtyId).not.toBe(ptyId)

      await execInTerminal(orcaPage, freshPtyId, 'top -b -n 1 > /dev/null; top')
      await waitForTerminalOutput(orcaPage, 'load average', 30_000, 8000)

      await reconnectDockerSshRelayTarget(orcaPage, remote.targetId)
      await waitForActiveTerminalManager(orcaPage, 60_000)
      await waitForActivePanePtyId(orcaPage, 60_000)

      // Fails here: the pane for this tab no longer exists, so nothing ever paints again.
      await waitForTerminalOutput(orcaPage, 'load average', 60_000, 8000)

      // The tab bar and the terminal slice must agree. They do not: the bar keeps rendering a tab
      // the slice has already dropped, which is why the failure looks like a dead tab rather than
      // a missing one.
      const tabCounts = await orcaPage.evaluate(() => {
        const state = window.__store?.getState()
        const worktreeId = state?.activeWorktreeId
        return {
          inSlice: worktreeId ? (state?.tabsByWorktree?.[worktreeId]?.length ?? 0) : 0,
          paneManagers: Object.keys(window.__paneManagers ?? {}).length
        }
      })
      expect(tabCounts.inSlice).toBeGreaterThanOrEqual(2)
      expect(tabCounts.paneManagers).toBeGreaterThanOrEqual(2)
    } finally {
      if (target) {
        cleanupDockerSshRelayTarget(target)
      }
    }
  })
})
