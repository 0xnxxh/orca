import { randomUUID } from 'node:crypto'
import type { FilesystemHostResult } from '../../shared/filesystem-host-protocol'
import type { FilesystemExecutionHost } from './filesystem-host-failure-domain'
import type { FilesystemHostDispatch } from './filesystem-host-supervisor-scheduling'
import type { FilesystemStorageClass } from './filesystem-host-telemetry'
import type { FilesystemHostBackgroundQueue } from './filesystem-host-background-queue'

type FailureDomainSupervisor = {
  dispatch(input: FilesystemHostDispatch): Promise<FilesystemHostResult>
  publishFailureDomain(input: {
    executionHost: FilesystemExecutionHost
    prefix: string
    mountId: string
  }): void
  removeFailureDomain(input: { executionHost: FilesystemExecutionHost; prefix: string }): void
}

type RoutePath = (path: string) => {
  executionHost: FilesystemExecutionHost
  storageClass: FilesystemStorageClass
}

export class FilesystemHostFailureDomainHydrator {
  private readonly classifiedPaths = new Set<string>()
  private readonly flights = new Map<string, Promise<void>>()
  private readonly persistentPaths = new Set<string>()
  private catalogPaths = new Set<string>()
  private readonly readLeases = new Map<string, number>()

  constructor(
    private readonly supervisor: FailureDomainSupervisor,
    private readonly queue: FilesystemHostBackgroundQueue,
    private readonly routePath: RoutePath,
    private readonly deadlineMs: number
  ) {}

  hydrate(paths: readonly string[]): void {
    for (const path of new Set(paths)) {
      this.persistentPaths.add(path)
      this.scheduleClassification(path)
    }
  }

  reconcile(paths: readonly string[]): void {
    const next = new Set(paths)
    const obsolete = new Set(
      [...this.catalogPaths].filter((path) => !next.has(path) && !this.isOwned(path, next))
    )
    for (const path of this.queue.cancelMany(obsolete)) {
      this.flights.delete(path)
    }
    for (const path of this.catalogPaths) {
      if (!next.has(path)) {
        this.evictIfUnowned(path, next)
      }
    }
    this.catalogPaths = next
    for (const path of next) {
      this.scheduleClassification(path)
    }
  }

  async acquire(path: string): Promise<() => void> {
    this.readLeases.set(path, (this.readLeases.get(path) ?? 0) + 1)
    try {
      await this.classify(path)
    } catch (error) {
      this.release(path)
      throw error
    }
    let released = false
    return () => {
      if (!released) {
        released = true
        this.release(path)
      }
    }
  }

  classify(path: string): Promise<void> {
    if (this.classifiedPaths.has(path)) {
      return Promise.resolve()
    }
    const existing = this.flights.get(path)
    if (existing) {
      return existing
    }
    const route = this.routePath(path)
    const flight = this.queue
      .run(async () => {
        const result = await this.supervisor.dispatch({
          operationId: randomUUID(),
          operation: { kind: 'classify-path', path },
          ...route,
          admission: 'background',
          deadlineMs: this.deadlineMs
        })
        if (result.kind !== 'classify-path') {
          throw new Error('Filesystem host returned the wrong classification result')
        }
        if (this.isOwned(path)) {
          this.supervisor.publishFailureDomain({
            executionHost: route.executionHost,
            prefix: path,
            mountId: result.deviceId
          })
          this.classifiedPaths.add(path)
        }
      }, path)
      .finally(() => {
        if (this.flights.get(path) === flight) {
          this.flights.delete(path)
        }
      })
    this.flights.set(path, flight)
    return flight
  }

  private release(path: string): void {
    const remaining = (this.readLeases.get(path) ?? 1) - 1
    if (remaining > 0) {
      this.readLeases.set(path, remaining)
      return
    }
    this.readLeases.delete(path)
    this.evictIfUnowned(path, this.catalogPaths)
  }

  private scheduleClassification(path: string): void {
    void this.classify(path)
      .then(() => {
        if (this.isOwned(path) && !this.classifiedPaths.has(path)) {
          void this.classify(path).catch(() => {})
        }
      })
      .catch(() => {})
  }

  private isOwned(path: string, catalogPaths: ReadonlySet<string> = this.catalogPaths): boolean {
    return (
      this.persistentPaths.has(path) ||
      catalogPaths.has(path) ||
      (this.readLeases.get(path) ?? 0) > 0
    )
  }

  private evictIfUnowned(path: string, catalogPaths: ReadonlySet<string>): void {
    if (this.isOwned(path, catalogPaths)) {
      return
    }
    if (this.queue.cancel(path)) {
      this.flights.delete(path)
    }
    this.classifiedPaths.delete(path)
    const route = this.routePath(path)
    this.supervisor.removeFailureDomain({ executionHost: route.executionHost, prefix: path })
  }
}
