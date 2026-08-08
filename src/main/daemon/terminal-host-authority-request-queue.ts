export class TerminalHostAuthorityRequestQueue {
  private readonly queues = new Map<string, Promise<void>>()

  enqueue<T>(sessionId: string, request: () => Promise<T>): Promise<T> {
    const previous = this.queues.get(sessionId) ?? Promise.resolve()
    const result = previous.then(request)
    const settled = result.then(
      () => undefined,
      () => undefined
    )
    this.queues.set(sessionId, settled)
    void settled.then(() => {
      if (this.queues.get(sessionId) === settled) {
        this.queues.delete(sessionId)
      }
    })
    return result
  }

  settlement(): Promise<void> | null {
    return this.queues.size > 0
      ? Promise.allSettled(this.queues.values()).then(() => undefined)
      : null
  }
}
