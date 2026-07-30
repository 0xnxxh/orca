import type { SshGitProvider } from './ssh-git-provider'

const sshProviders = new Map<string, SshGitProvider>()
const sshProviderGenerations = new Map<string, number>()
const sshProviderRegistryListeners = new Set<
  (event: {
    connectionId: string
    generation: number
    provider: SshGitProvider | undefined
  }) => void
>()

export const SSH_GIT_PROVIDER_UNAVAILABLE_MESSAGE =
  'Remote connection dropped. Click Reconnect on the SSH target before retrying.'

export function registerSshGitProvider(connectionId: string, provider: SshGitProvider): void {
  sshProviders.set(connectionId, provider)
  const generation = (sshProviderGenerations.get(connectionId) ?? 0) + 1
  sshProviderGenerations.set(connectionId, generation)
  notifySshGitProviderRegistry({ connectionId, generation, provider })
}

export function unregisterSshGitProvider(connectionId: string): void {
  if (sshProviders.delete(connectionId)) {
    const generation = (sshProviderGenerations.get(connectionId) ?? 0) + 1
    sshProviderGenerations.set(connectionId, generation)
    notifySshGitProviderRegistry({ connectionId, generation, provider: undefined })
  }
}

export function subscribeSshGitProviderRegistry(
  listener: (event: {
    connectionId: string
    generation: number
    provider: SshGitProvider | undefined
  }) => void
): () => void {
  sshProviderRegistryListeners.add(listener)
  return () => sshProviderRegistryListeners.delete(listener)
}

export function getSshGitProviderGeneration(connectionId: string): number {
  return sshProviderGenerations.get(connectionId) ?? 0
}

export function getSshGitProvider(connectionId: string): SshGitProvider | undefined {
  return sshProviders.get(connectionId)
}

export function requireSshGitProvider(connectionId: string): SshGitProvider {
  const provider = getSshGitProvider(connectionId)
  if (!provider) {
    throw new Error(SSH_GIT_PROVIDER_UNAVAILABLE_MESSAGE)
  }
  return provider
}

function notifySshGitProviderRegistry(event: {
  connectionId: string
  generation: number
  provider: SshGitProvider | undefined
}): void {
  for (const listener of sshProviderRegistryListeners) {
    listener(event)
  }
}
