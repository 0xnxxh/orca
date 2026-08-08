import { failTerminalSessionAuthority } from '../../shared/terminal-session-authority-mutation'

export class TerminalSessionAuthorityOperationQueue {
  private tail: Promise<void> = Promise.resolve()
  private accepting = true
  private closed = false
  private crashed = false
  private closePromise: Promise<void> | null = null
  private readonly producerHolds = new Set<object>()
  private producerHoldGate: Promise<void> | null = null
  private releaseProducerHoldGate: (() => void) | null = null

  crash(): void {
    this.crashed = true
  }

  enqueue<T>(operation: () => Promise<T>): Promise<T> {
    this.assertAccepting()
    const result = this.tail.then(operation)
    this.tail = result.then(
      () => undefined,
      () => undefined
    )
    return result
  }

  enqueueProducer<T>(operation: () => Promise<T>): Promise<T> {
    this.assertAccepting()
    const gate = this.producerHoldGate
    if (gate) {
      return gate.then(() => this.enqueueProducer(operation))
    }
    return this.enqueue(operation)
  }

  acquireProducerHold(): Readonly<{ release(): void }> {
    this.assertAccepting()
    const token = Object.freeze({})
    if (this.producerHolds.size === 0) {
      this.producerHoldGate = new Promise((resolve) => {
        this.releaseProducerHoldGate = resolve
      })
    }
    this.producerHolds.add(token)
    let released = false
    return Object.freeze({
      release: () => {
        if (released) {
          return
        }
        released = true
        this.producerHolds.delete(token)
        if (this.producerHolds.size === 0) {
          this.releaseProducerHolds()
        }
      }
    })
  }

  close(cleanup: () => Promise<void>): Promise<void> {
    if (this.closePromise) {
      return this.closePromise
    }
    this.accepting = false
    this.producerHolds.clear()
    this.releaseProducerHolds()
    this.closePromise = (async () => {
      await this.tail
      this.closed = true
      await cleanup()
    })()
    return this.closePromise
  }

  assertAccepting(): void {
    if (!this.accepting) {
      failTerminalSessionAuthority('writer-fenced', 'authority service is unavailable')
    }
    this.assertProcessing()
  }

  assertProcessing(): void {
    if (this.closed || this.crashed) {
      failTerminalSessionAuthority('writer-fenced', 'authority service is unavailable')
    }
  }

  private releaseProducerHolds(): void {
    const release = this.releaseProducerHoldGate
    this.producerHoldGate = null
    this.releaseProducerHoldGate = null
    release?.()
  }
}
