export type ClientSessionTabActivationIntent = symbol

export class ClientSessionTabActivationIntentTracker {
  private intentByClient = new Map<string, ClientSessionTabActivationIntent>()

  begin(clientNavigationId: string): ClientSessionTabActivationIntent {
    const intent = Symbol(clientNavigationId)
    this.intentByClient.set(clientNavigationId, intent)
    return intent
  }

  claim(clientNavigationId: string, intent?: ClientSessionTabActivationIntent): boolean {
    if (intent !== undefined && this.intentByClient.get(clientNavigationId) !== intent) {
      return false
    }
    if (intent === undefined) {
      this.begin(clientNavigationId)
    }
    return true
  }

  current(clientNavigationId: string): ClientSessionTabActivationIntent | undefined {
    return this.intentByClient.get(clientNavigationId)
  }

  supersedeIfCurrent(
    clientNavigationId: string,
    intent: ClientSessionTabActivationIntent | undefined
  ): boolean {
    if (this.intentByClient.get(clientNavigationId) !== intent) {
      return false
    }
    this.begin(clientNavigationId)
    return true
  }

  clientIds(): IterableIterator<string> {
    return this.intentByClient.keys()
  }

  forgetClient(clientNavigationId: string): void {
    this.intentByClient.delete(clientNavigationId)
  }
}
