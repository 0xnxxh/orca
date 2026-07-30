import { CodexUsageStore } from '../codex-usage/store'

type CodexUsageStoreParameters = ConstructorParameters<typeof CodexUsageStore>

export function createCodexUsageStoreStartupCapability(
  store: CodexUsageStoreParameters[0]
): CodexUsageStore {
  return new CodexUsageStore(store)
}
