type ActiveStopLease = {
  readonly settled: Promise<void>
  readonly resolve: () => void
}

export type MobileNativeChatStopLease = {
  release: () => void
}

const activeStops = new Map<string, ActiveStopLease>()

export function acquireMobileNativeChatStopLease(
  terminal: string
): MobileNativeChatStopLease | null {
  if (activeStops.has(terminal)) {
    return null
  }
  let resolve!: () => void
  const lease = {
    settled: new Promise<void>((complete) => {
      resolve = complete
    }),
    resolve: () => resolve()
  }
  activeStops.set(terminal, lease)
  return {
    release: () => {
      if (activeStops.get(terminal) !== lease) {
        return
      }
      activeStops.delete(terminal)
      lease.resolve()
    }
  }
}

export async function waitForMobileNativeChatStopLease(terminal: string): Promise<void> {
  while (true) {
    const lease = activeStops.get(terminal)
    if (!lease) {
      return
    }
    await lease.settled
  }
}

export function resetMobileNativeChatStopLeasesForTests(): void {
  const leases = [...activeStops.values()]
  activeStops.clear()
  for (const lease of leases) {
    lease.resolve()
  }
}
