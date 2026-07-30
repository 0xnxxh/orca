import { ClaudeUsageStore } from '../claude-usage/store'

type ClaudeUsageStoreParameters = ConstructorParameters<typeof ClaudeUsageStore>

export function createClaudeUsageStoreStartupCapability(
  store: ClaudeUsageStoreParameters[0]
): ClaudeUsageStore {
  return new ClaudeUsageStore(store)
}
