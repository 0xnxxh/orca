export class StructuredAgentSessionHandoffQueue {
  private readonly controllers = new Map<string, AbortController>()

  cancel(sessionId: string): void {
    this.controllers.get(sessionId)?.abort()
    this.controllers.delete(sessionId)
  }

  enqueue(
    sessionId: string,
    isIdle: (signal: AbortSignal) => boolean | Promise<boolean>,
    onReady: () => void
  ): void {
    this.cancel(sessionId)
    const controller = new AbortController()
    this.controllers.set(sessionId, controller)
    void this.waitUntilIdle(sessionId, controller, isIdle).then((ready) => {
      if (ready) {
        onReady()
      }
    })
  }

  private async waitUntilIdle(
    sessionId: string,
    controller: AbortController,
    isIdle: (signal: AbortSignal) => boolean | Promise<boolean>
  ): Promise<boolean> {
    while (this.controllers.get(sessionId) === controller && !controller.signal.aborted) {
      try {
        if (await isIdle(controller.signal)) {
          this.controllers.delete(sessionId)
          return true
        }
      } catch {
        if (controller.signal.aborted) {
          return false
        }
      }
      await new Promise((resolve) => setTimeout(resolve, 150))
    }
    return false
  }
}
