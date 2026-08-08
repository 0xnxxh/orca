import type { IPtyProvider, PtyProcessInfo } from '../providers/types'

export type DaemonPtyProviderInventory<TProvider extends IPtyProvider> = Readonly<{
  provider: TProvider
  processes: readonly PtyProcessInfo[]
}>

type DaemonPtyInventoryRouting<TProvider extends IPtyProvider> = Readonly<{
  existingRouteIds: Iterable<string>
  recordRoute: (id: string, provider: TProvider, process: PtyProcessInfo) => void
  forgetRoute: (id: string) => void
}>

export function reconcileDaemonPtyProviderInventory<TProvider extends IPtyProvider>(
  inventories: readonly DaemonPtyProviderInventory<TProvider>[],
  routing: DaemonPtyInventoryRouting<TProvider>
): PtyProcessInfo[] {
  const candidatesById = new Map<string, { provider: TProvider; process: PtyProcessInfo }[]>()
  for (const { provider, processes } of inventories) {
    for (const process of processes) {
      const candidates = candidatesById.get(process.id) ?? []
      candidates.push({ provider, process })
      candidatesById.set(process.id, candidates)
    }
  }

  for (const id of routing.existingRouteIds) {
    if (!candidatesById.has(id)) {
      routing.forgetRoute(id)
    }
  }
  for (const [id, candidates] of candidatesById) {
    const candidate = candidates.length === 1 ? candidates[0] : undefined
    if (candidate) {
      routing.recordRoute(id, candidate.provider, candidate.process)
    } else {
      routing.forgetRoute(id)
    }
  }

  return inventories.flatMap(({ provider, processes }) =>
    processes.map((process) => {
      const listedRouteToken = process.mutationRouteToken
      const unique = candidatesById.get(process.id)?.length === 1
      const routeToken = unique
        ? currentListedRouteToken(provider, process.id, listedRouteToken)
        : null
      if (routeToken || listedRouteToken === undefined) {
        return process
      }
      const { mutationRouteToken: _discarded, ...withoutRouteToken } = process
      return withoutRouteToken
    })
  )
}

function currentListedRouteToken(
  provider: IPtyProvider,
  id: string,
  listed: object | undefined
): object | null {
  if (!listed || !provider.getPtyMutationRouteToken) {
    return null
  }
  try {
    return provider.getPtyMutationRouteToken(id) === listed ? listed : null
  } catch {
    return null
  }
}
