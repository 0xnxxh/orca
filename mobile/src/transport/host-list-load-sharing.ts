import type { HostProfile } from './types'

// Why: Keychain reads are slow (50-200ms) and loadHosts() runs on every screen
// mount, so concurrent callers share one pass instead of each paying for their
// own. A pass that started before a write still holds the pre-write snapshot,
// though — handing it to a caller that loaded AFTER the write returns the host
// that caller just removed, or the name it just replaced (issue #8791). So every
// durable commit drops the shared pass and the next caller reads fresh.
let inflight: Promise<HostProfile[]> | null = null

export function shareHostListLoad(load: () => Promise<HostProfile[]>): Promise<HostProfile[]> {
  if (inflight) {
    return inflight
  }
  const started = load().finally(() => {
    // Why: a dropped pass can settle after its replacement started; only retire
    // the entry still on offer, or the replacement is silently discarded.
    if (inflight === started) {
      inflight = null
    }
  })
  inflight = started
  return started
}

/** Call after every durable host write so no later read is served a pre-write pass. */
export function dropSharedHostListLoad(): void {
  inflight = null
}
