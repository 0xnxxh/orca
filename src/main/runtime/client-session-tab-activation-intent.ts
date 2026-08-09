export type ClientSessionTabActivationIntent = symbol

export class ClientSessionTabActivationIntentTracker {
  private intentByClient = new Map<string, ClientSessionTabActivationIntent>()
  private invalidatedTabIdsByIntent = new Map<ClientSessionTabActivationIntent, Set<string>>()

  begin(clientNavigationId: string): ClientSessionTabActivationIntent {
    const previousIntent = this.intentByClient.get(clientNavigationId)
    if (previousIntent) {
      this.invalidatedTabIdsByIntent.delete(previousIntent)
    }
    const intent = Symbol(clientNavigationId)
    this.intentByClient.set(clientNavigationId, intent)
    return intent
  }

  claim(
    clientNavigationId: string,
    intent?: ClientSessionTabActivationIntent,
    targetTabIds: readonly string[] = []
  ): boolean {
    if (intent !== undefined && this.intentByClient.get(clientNavigationId) !== intent) {
      return false
    }
    if (intent === undefined) {
      this.begin(clientNavigationId)
    }
    const invalidatedTabIds = intent ? this.invalidatedTabIdsByIntent.get(intent) : undefined
    return !invalidatedTabIds || !targetTabIds.some((tabId) => invalidatedTabIds.has(tabId))
  }

  current(clientNavigationId: string): ClientSessionTabActivationIntent | undefined {
    return this.intentByClient.get(clientNavigationId)
  }

  invalidateIfCurrent(
    clientNavigationId: string,
    intent: ClientSessionTabActivationIntent | undefined,
    tabIds: readonly string[]
  ): boolean {
    if (this.intentByClient.get(clientNavigationId) !== intent || intent === undefined) {
      return false
    }
    const invalidatedTabIds = this.invalidatedTabIdsByIntent.get(intent) ?? new Set<string>()
    for (const tabId of tabIds) {
      invalidatedTabIds.add(tabId)
    }
    this.invalidatedTabIdsByIntent.set(intent, invalidatedTabIds)
    return true
  }

  clientIds(): IterableIterator<string> {
    return this.intentByClient.keys()
  }

  forgetClient(clientNavigationId: string): void {
    const intent = this.intentByClient.get(clientNavigationId)
    this.intentByClient.delete(clientNavigationId)
    if (intent) {
      this.invalidatedTabIdsByIntent.delete(intent)
    }
  }
}
