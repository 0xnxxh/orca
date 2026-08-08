import {
  TERMINAL_AUTHORITY_APP_PROJECTION_VERSION,
  type TerminalAuthorityAppPaneProjection,
  type TerminalAuthorityAppProjectionDelta,
  type TerminalAuthorityAppProjectionRowIdentity,
  type TerminalAuthorityAppProjectionSnapshot
} from '../../shared/terminal-authority-app-projection'
import { parseTerminalAuthorityAppProjectionSubscribe } from '../../shared/terminal-authority-app-projection-validation'

type AttachedRenderer = Readonly<{
  token: object
  send: (delta: TerminalAuthorityAppProjectionDelta) => void
}>

export type PtyAuthorityProjectionRendererAdmission = Readonly<{
  rendererToken: object | null
  lifecycleGeneration: number
}>

export class PtyAuthorityProjectionBroker {
  private renderer: AttachedRenderer | null = null
  private rendererLifecycleGeneration = 0
  private subscriptionIncarnationId: string | null = null
  private operationQueue: Promise<void> = Promise.resolve()

  constructor(private readonly snapshotRows: () => readonly TerminalAuthorityAppPaneProjection[]) {}

  attachRenderer(token: object, send: (delta: TerminalAuthorityAppProjectionDelta) => void): void {
    this.renderer = Object.freeze({ token, send })
    this.fenceRendererSubscription()
  }

  resetRenderer(token: object): void {
    if (this.renderer?.token === token) {
      this.fenceRendererSubscription()
    }
  }

  detachRenderer(token: object): void {
    if (this.renderer?.token === token) {
      this.renderer = null
      this.fenceRendererSubscription()
    }
  }

  admitRendererRequest(token: object): PtyAuthorityProjectionRendererAdmission {
    return Object.freeze({
      rendererToken: this.renderer?.token === token ? token : null,
      lifecycleGeneration: this.rendererLifecycleGeneration
    })
  }

  subscribe(
    token: object,
    value: unknown,
    admission = this.admitRendererRequest(token)
  ): Promise<TerminalAuthorityAppProjectionSnapshot> {
    const request = parseTerminalAuthorityAppProjectionSubscribe(value)
    return this.enqueue(() => {
      if (this.renderer?.token !== token || admission.rendererToken !== token) {
        throw new Error('terminal_authority_projection_sender_stale')
      }
      if (admission.lifecycleGeneration !== this.rendererLifecycleGeneration) {
        throw new Error('terminal_authority_projection_subscription_stale')
      }
      if (!request) {
        throw new Error('terminal_authority_projection_subscription_invalid')
      }
      const current = this.subscriptionIncarnationId
      if (
        current !== null &&
        current !== request.subscriptionIncarnationId &&
        current !== request.expectedSubscriptionIncarnationId
      ) {
        throw new Error('terminal_authority_projection_subscription_stale')
      }
      this.subscriptionIncarnationId = request.subscriptionIncarnationId
      return Object.freeze({
        version: TERMINAL_AUTHORITY_APP_PROJECTION_VERSION,
        subscriptionIncarnationId: request.subscriptionIncarnationId,
        rows: Object.freeze([...this.snapshotRows()])
      })
    })
  }

  publish(
    rows: readonly TerminalAuthorityAppPaneProjection[],
    deleted: readonly TerminalAuthorityAppProjectionRowIdentity[] = []
  ): void {
    const renderer = this.renderer
    const subscriptionIncarnationId = this.subscriptionIncarnationId
    if (!renderer || !subscriptionIncarnationId || (rows.length === 0 && deleted.length === 0)) {
      return
    }
    try {
      renderer.send(
        Object.freeze({
          version: TERMINAL_AUTHORITY_APP_PROJECTION_VERSION,
          subscriptionIncarnationId,
          rows: Object.freeze([...rows]),
          ...(deleted.length > 0 ? { deleted: Object.freeze([...deleted]) } : {})
        })
      )
    } catch {
      this.fenceRendererSubscription()
    }
  }

  private fenceRendererSubscription(): void {
    this.rendererLifecycleGeneration += 1
    this.subscriptionIncarnationId = null
  }

  private enqueue<T>(operation: () => T): Promise<T> {
    const result = this.operationQueue.then(operation)
    this.operationQueue = result.then(
      () => undefined,
      () => undefined
    )
    return result
  }
}
