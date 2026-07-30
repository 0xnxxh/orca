import type { GitRepositorySnapshotSubscriptionEvent } from '../../../../shared/git-repository-snapshot'
import type { GitPushTarget } from '../../../../shared/types'
import type { DesktopGitRepositorySnapshotContext } from '@/runtime/desktop-git-repository-snapshot-client'
import { subscribeRuntimeGitRepositorySnapshotRevision } from '@/runtime/runtime-git-repository-snapshot-revision-client'

type Callbacks = {
  onReady: (event: GitRepositorySnapshotSubscriptionEvent) => void
  onInvalidated: (event: GitRepositorySnapshotSubscriptionEvent) => void
  onReplay: () => void
  onUnavailable: (error: unknown) => void
}

export class ChecksPanelRuntimeRepositorySnapshotRevisions {
  private active = false
  private closed = false
  private failed = false
  private registrations: [number | null, number | null] = [null, null]
  private replaying = false
  private replaySeen: [boolean, boolean] = [false, false]
  private readonly handles: { unsubscribe: () => void }[] = []
  private pendingReadyIncarnation: number | null = null
  private readyRead: { read: number; incarnation: number } | null = null

  constructor(
    readonly key: string,
    context: DesktopGitRepositorySnapshotContext,
    pushTarget: GitPushTarget | null,
    private readonly callbacks: Callbacks
  ) {
    const options = pushTarget ? { pushTarget } : {}
    this.startRegistration(0, context, options)
    this.startRegistration(1, context, { ...options, reuseLineStats: true })
  }

  retain(): void {
    this.active = true
  }

  releaseAfterTurn(onReleased: () => void): void {
    this.active = false
    queueMicrotask(() => {
      if (this.active) {
        return
      }
      this.close()
      onReleased()
    })
  }

  beginRead(read: number): void {
    const incarnation = this.pairedIncarnation()
    if (
      this.active &&
      !this.failed &&
      incarnation !== null &&
      this.pendingReadyIncarnation === incarnation
    ) {
      this.pendingReadyIncarnation = null
      this.readyRead = { read, incarnation }
    }
  }

  finishRead(read: number, admittedSnapshot: boolean): boolean {
    const readyRead = this.readyRead
    if (!readyRead || readyRead.read !== read) {
      return false
    }
    this.readyRead = null
    return (
      admittedSnapshot &&
      this.active &&
      !this.failed &&
      this.pairedIncarnation() === readyRead.incarnation
    )
  }

  close(): void {
    if (this.closed) {
      return
    }
    this.closed = true
    for (const handle of this.handles.splice(0)) {
      handle.unsubscribe()
    }
  }

  get isClosed(): boolean {
    return this.closed
  }

  private startRegistration(
    index: 0 | 1,
    context: DesktopGitRepositorySnapshotContext,
    options: { pushTarget?: GitPushTarget; reuseLineStats?: boolean }
  ): void {
    void subscribeRuntimeGitRepositorySnapshotRevision(context, options, {
      onSubscribed: (incarnation) => {
        if (!this.closed) {
          const current = this.registrations[index]
          if (current === null || incarnation >= current) {
            this.registrations[index] = incarnation
          }
          if (this.replaySeen.every(Boolean) && this.pairedIncarnation() !== null) {
            this.replaying = false
          }
        }
      },
      onRevision: (event) => {
        if (this.closed || this.failed) {
          return
        }
        if (event.state === 'invalidated') {
          const current = this.registrations[index]
          if (current !== null && event.incarnation < current) {
            return
          }
          this.registrations[index] = event.incarnation
          this.pendingReadyIncarnation = null
          this.readyRead = null
          this.callbacks.onInvalidated(event)
          return
        }
        const incarnation = this.pairedIncarnation()
        if (
          incarnation === null ||
          event.incarnation !== incarnation ||
          this.registrations[index] !== event.incarnation
        ) {
          return
        }
        this.pendingReadyIncarnation = incarnation
        this.callbacks.onReady(event)
      },
      onUnavailable: (error) => this.fail(error),
      onReplay: () => {
        if (this.closed || this.failed) {
          return
        }
        if (!this.replaying) {
          this.replaying = true
          this.replaySeen = [false, false]
          this.registrations = [null, null]
          this.callbacks.onReplay()
        }
        this.replaySeen[index] = true
        this.registrations[index] = null
        this.pendingReadyIncarnation = null
        this.readyRead = null
      },
      onEnd: () => this.fail(new Error('Repository snapshot revision stream ended'))
    })
      .then((handle) => {
        if (!handle) {
          this.fail(new Error('Repository snapshot revision stream is unavailable'))
          return
        }
        if (this.closed) {
          handle.unsubscribe()
          return
        }
        this.handles.push(handle)
      })
      .catch((error) => this.fail(error))
  }

  private pairedIncarnation(): number | null {
    const [normal, reuseLineStats] = this.registrations
    return normal !== null && normal === reuseLineStats ? normal : null
  }

  private fail(error: unknown): void {
    if (this.closed || this.failed) {
      return
    }
    if (!this.active) {
      this.close()
      return
    }
    this.failed = true
    this.close()
    this.callbacks.onUnavailable(error)
  }
}

export function checksPanelRepositorySnapshotPushTargetKey(
  pushTarget: GitPushTarget | null
): unknown {
  if (!pushTarget) {
    return null
  }
  return {
    remoteName: pushTarget.remoteName,
    branchName: pushTarget.branchName,
    remoteUrl: pushTarget.remoteUrl ?? null,
    remoteCreated: Object.prototype.hasOwnProperty.call(pushTarget, 'remoteCreated')
      ? pushTarget.remoteCreated
      : 'absent'
  }
}
