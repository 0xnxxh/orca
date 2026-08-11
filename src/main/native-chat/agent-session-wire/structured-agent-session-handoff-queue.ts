export class StructuredAgentSessionHandoffQueue {
  private readonly tokens = new Map<string, symbol>()

  cancel(sessionId: string): void {
    this.tokens.delete(sessionId)
  }

  enqueue(sessionId: string, isIdle: () => boolean, onReady: () => void): void {
    const token = Symbol(sessionId)
    this.tokens.set(sessionId, token)
    void this.waitUntilIdle(sessionId, token, isIdle).then((ready) => {
      if (ready) {
        onReady()
      }
    })
  }

  private async waitUntilIdle(
    sessionId: string,
    token: symbol,
    isIdle: () => boolean
  ): Promise<boolean> {
    while (this.tokens.get(sessionId) === token) {
      if (isIdle()) {
        this.tokens.delete(sessionId)
        return true
      }
      await new Promise((resolve) => setTimeout(resolve, 150))
    }
    return false
  }
}
