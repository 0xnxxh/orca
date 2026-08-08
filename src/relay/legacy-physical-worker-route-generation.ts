export class LegacyPhysicalWorkerRouteGeneration {
  private next = 1

  mint(): number {
    if (!Number.isSafeInteger(this.next)) {
      throw new Error('legacy physical worker route generation exhausted')
    }
    return this.next++
  }
}
