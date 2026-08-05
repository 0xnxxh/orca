import type { IPtyProvider } from '../providers/types'
import type { DaemonPtyAdapter } from './daemon-pty-adapter'

export async function probePtyOwners(
  id: string,
  routed: IPtyProvider | undefined,
  possibleOwners: readonly DaemonPtyAdapter[],
  // Owners with a captured startup inventory can't own an unrouted id (fresh
  // sessions never land on them), so their answer is knowably "absent" without
  // a round trip — one wedged superseded daemon must not make every unmapped
  // probe unprovable (STA-3536). Callers must never inventory the current
  // daemon: it still gains sessions.
  inventoriedOwners?: ReadonlySet<DaemonPtyAdapter>
): Promise<boolean | null> {
  if (routed) {
    return routed.probePtyLiveness
      ? await routed.probePtyLiveness(id)
      : (routed.hasPty?.(id) ?? null)
  }
  const consulted = inventoriedOwners
    ? possibleOwners.filter((provider) => !inventoriedOwners.has(provider))
    : possibleOwners
  if (consulted.length === 0) {
    return null
  }
  const results = await Promise.all(consulted.map((provider) => provider.probePtyLiveness(id)))
  return results.some((result) => result === true)
    ? true
    : results.every((result) => result === false)
      ? false
      : null
}
