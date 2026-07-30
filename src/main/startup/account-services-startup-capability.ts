import { ClaudeAccountService } from '../claude-accounts/service'
import { ClaudeRuntimeAuthService } from '../claude-accounts/runtime-auth-service'
import { CodexAccountService, type CodexAccountServiceLifecycle } from '../codex-accounts/service'
import { CodexRuntimeHomeService } from '../codex-accounts/runtime-home-service'
import type { Store } from '../persistence'
import { RateLimitService } from '../rate-limits/service'

type CodexRuntimeHomeStartupConfiguration = {
  codexAccountLifecycle: CodexAccountServiceLifecycle
  afterCodexAccountCreated: () => void
}

type AccountServicesStartupOptions = {
  configureCodexRuntimeHome: (
    runtimeHome: CodexRuntimeHomeService
  ) => CodexRuntimeHomeStartupConfiguration
}

export type AccountServicesStartupCapability = {
  rateLimits: RateLimitService
  codexRuntimeHome: CodexRuntimeHomeService
  codexAccounts: CodexAccountService
  claudeRuntimeAuth: ClaudeRuntimeAuthService
  claudeAccounts: ClaudeAccountService
}

export function createAccountServicesStartupCapability(
  store: Store,
  options: AccountServicesStartupOptions
): AccountServicesStartupCapability {
  const rateLimits = new RateLimitService()
  const codexRuntimeHome = new CodexRuntimeHomeService(store)
  const codexConfiguration = options.configureCodexRuntimeHome(codexRuntimeHome)
  const codexAccounts = new CodexAccountService(
    store,
    rateLimits,
    codexRuntimeHome,
    codexConfiguration.codexAccountLifecycle
  )
  codexConfiguration.afterCodexAccountCreated()
  const claudeRuntimeAuth = new ClaudeRuntimeAuthService(store)
  const claudeAccounts = new ClaudeAccountService(store, rateLimits, claudeRuntimeAuth)

  return {
    rateLimits,
    codexRuntimeHome,
    codexAccounts,
    claudeRuntimeAuth,
    claudeAccounts
  }
}
