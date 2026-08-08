import type { Page } from '@stablyai/playwright-test'
import type { ConnectedDockerSshRelayTarget } from './docker-ssh-relay-connection'
import {
  DOCKER_SSH_RELAY_REMOTE_REPO_PATH,
  type DockerSshRelayTarget
} from './docker-ssh-relay-target'

export type ConnectedDockerSshAuthorityClient = {
  targetId: string
  providerEpoch: string
  connectionGeneration: number
}

export async function connectDockerSshAuthorityClientsConcurrently(
  page: Page,
  target: DockerSshRelayTarget,
  count = 2
): Promise<ConnectedDockerSshAuthorityClient[]> {
  if (!Number.isInteger(count) || count < 2 || count > 8) {
    throw new Error('Concurrent Docker SSH authority client count must be between 2 and 8')
  }
  return page.evaluate(
    async ({ target, count }) => {
      const store = window.__store
      if (!store) {
        throw new Error('Store unavailable')
      }
      const credentialUnsub = window.api.ssh.onCredentialRequest((request) => {
        void window.api.ssh.submitCredential({ requestId: request.requestId, value: null })
      })
      try {
        const added = await Promise.all(
          Array.from({ length: count }, (_, index) =>
            window.api.ssh.addTarget({
              target: {
                label: `Docker SSH Authority Race ${index + 1} ${Date.now()}`,
                host: target.host,
                port: target.port,
                username: 'root',
                identityFile: target.identityFile,
                identitiesOnly: true,
                relayGracePeriodSeconds: 300
              }
            })
          )
        )
        for (const result of added) {
          store.getState().recordSshRepoReadoptions(result.repoReadoptions)
        }
        const states = await Promise.all(
          added.map(({ target: createdTarget }) =>
            window.api.ssh.connect({ targetId: createdTarget.id })
          )
        )
        return states.map((state, index) => {
          const createdTarget = added[index]?.target
          if (
            !createdTarget ||
            !state ||
            state.status !== 'connected' ||
            !state.providerEpoch ||
            !Number.isSafeInteger(state.connectionGeneration)
          ) {
            throw new Error(`Concurrent SSH authority client failed: ${JSON.stringify(state)}`)
          }
          store.getState().setSshConnectionState(createdTarget.id, state)
          const labels = new Map(store.getState().sshTargetLabels)
          labels.set(createdTarget.id, createdTarget.label)
          store.getState().setSshTargetLabels(labels)
          return {
            targetId: createdTarget.id,
            providerEpoch: state.providerEpoch,
            connectionGeneration: state.connectionGeneration
          }
        })
      } finally {
        credentialUnsub()
      }
    },
    { target, count }
  )
}

export async function activateConnectedDockerSshRelayTarget(
  page: Page,
  targetId: string,
  remotePath = DOCKER_SSH_RELAY_REMOTE_REPO_PATH
): Promise<ConnectedDockerSshRelayTarget> {
  return page.evaluate(
    async ({ targetId, remotePath }) => {
      const store = window.__store
      if (!store) {
        throw new Error('Store unavailable')
      }
      const authority = store.getState().sshConnectionStates.get(targetId)
      if (
        authority?.status !== 'connected' ||
        !authority.providerEpoch ||
        !Number.isSafeInteger(authority.connectionGeneration)
      ) {
        throw new Error(`SSH target is not authoritatively connected: ${targetId}`)
      }
      const result = await window.api.repos.addRemote({
        connectionId: targetId,
        remotePath,
        displayName: 'Docker SSH Authority Race E2E'
      })
      if ('error' in result) {
        throw new Error(result.error)
      }
      await store.getState().fetchRepos()
      const executionHostId = `ssh:${encodeURIComponent(targetId)}` as const
      const worktreeResult = await store.getState().fetchWorktrees(result.repo.id, {
        executionHostId,
        directSshAuthority: {
          targetId,
          providerEpoch: authority.providerEpoch,
          connectionGeneration: authority.connectionGeneration
        },
        requireAuthoritative: true
      })
      if (worktreeResult.status !== 'complete') {
        throw new Error(`Remote worktree hydration failed: ${JSON.stringify(worktreeResult)}`)
      }
      const worktree = (store.getState().worktreesByRepo[result.repo.id] ?? []).find(
        (candidate) => candidate.hostId === executionHostId
      )
      if (!worktree) {
        throw new Error(`No remote worktree found for ${result.repo.path}`)
      }
      store.getState().setActiveWorktree(worktree.id)
      if ((store.getState().tabsByWorktree[worktree.id] ?? []).length === 0) {
        store.getState().createTab(worktree.id)
      }
      store.getState().setActiveTabType('terminal')
      return { targetId, repoId: result.repo.id, worktreeId: worktree.id }
    },
    { targetId, remotePath }
  )
}
