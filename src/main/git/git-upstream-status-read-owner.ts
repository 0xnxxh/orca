import type { GitPushTarget, GitUpstreamStatus } from '../../shared/types'
import { InFlightPromiseDedupe, stableInFlightKey } from '../../shared/in-flight-promise-dedupe'

export type GitUpstreamStatusExecutionIdentity =
  | { kind: 'native' }
  | { kind: 'wsl'; distro: string }
  | { kind: 'ssh-provider' }

export class GitUpstreamStatusReadOwner {
  private readonly inFlightReads = new InFlightPromiseDedupe<GitUpstreamStatus>()

  read(
    executionIdentity: GitUpstreamStatusExecutionIdentity,
    worktreePath: string,
    pushTarget: GitPushTarget | undefined,
    load: () => Promise<GitUpstreamStatus>
  ): Promise<GitUpstreamStatus> {
    const key = stableInFlightKey([
      executionIdentity,
      worktreePath,
      pushTarget
        ? [
            'explicit-target',
            pushTarget.remoteName,
            pushTarget.branchName,
            pushTarget.remoteUrl ?? null,
            pushTarget.remoteCreated ?? null
          ]
        : ['configured-upstream']
    ])
    return this.inFlightReads.run(key, load)
  }

  invalidate(): void {
    this.inFlightReads.clear()
  }
}

export const nativeAndWslGitUpstreamStatusReadOwner = new GitUpstreamStatusReadOwner()
