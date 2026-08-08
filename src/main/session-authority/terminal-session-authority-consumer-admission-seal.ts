import type { TerminalAuthorityConsumerAccess } from './terminal-session-authority-access'

/**
 * The proof-bound live state a durable `consumer-claim` publishes with: the connection-bound grant,
 * the exact-retry publication, the pump's consumer, and the connection's namespace ownership. The
 * service runs all of it inside one namespace-queue operation.
 *
 * `seal` reserves and may throw; nothing is visible yet, so a concurrent exact retry cannot observe
 * authority while the append is pending. `commit` runs only after the append and must not throw, so
 * nothing fallible stands between a durable claim and the grant that authorizes it. `abort` releases
 * a seal that never committed.
 */
export type TerminalAuthorityConsumerAdmissionSeal = Readonly<{
  seal(): void
  commit(claimed: TerminalAuthorityConsumerAccess): void
  abort(): void
}>

export function composeTerminalAuthorityConsumerAdmissionSeals(
  seals: readonly (TerminalAuthorityConsumerAdmissionSeal | null | undefined)[]
): TerminalAuthorityConsumerAdmissionSeal {
  const present = seals.filter((seal): seal is TerminalAuthorityConsumerAdmissionSeal =>
    Boolean(seal)
  )
  return Object.freeze({
    seal: () => {
      const sealed: TerminalAuthorityConsumerAdmissionSeal[] = []
      try {
        for (const entry of present) {
          entry.seal()
          sealed.push(entry)
        }
      } catch (error) {
        abortAll(sealed)
        throw error
      }
    },
    commit: (claimed) => {
      for (const entry of present) {
        entry.commit(claimed)
      }
    },
    abort: () => abortAll(present)
  })
}

// Reverse order, so a component releases before whatever it was sealed on top of. Abort runs while a
// pre-append error is already unwinding, and every release is a map delete.
function abortAll(seals: readonly TerminalAuthorityConsumerAdmissionSeal[]): void {
  for (let index = seals.length - 1; index >= 0; index--) {
    seals[index]!.abort()
  }
}
