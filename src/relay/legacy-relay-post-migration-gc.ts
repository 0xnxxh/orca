import { open, mkdir, readFile, rename, rm } from 'node:fs/promises'
import path from 'node:path'
import type { TerminalLegacyGcProtection } from '../shared/terminal-legacy-cutover'
import {
  assertLegacyRelayGcCandidatePath,
  canonicalLegacyRelayGcRoots,
  eligibleLegacyRelayGcCandidates,
  type LegacyRelayGcCandidate,
  type LegacyRelayGcFileSystem
} from './legacy-relay-gc-path-policy'
import {
  createLegacyRelayGcQuarantineHold,
  quarantineAndRemoveLegacyRelayGcCandidate,
  resumeLegacyRelayGcQuarantine,
  type LegacyRelayGcQuarantineHold
} from './legacy-relay-gc-quarantine'
import { LegacyRelayGcQuarantineStore } from './legacy-relay-gc-quarantine-store'

const BARRIER_VERSION = 1
const MAX_BARRIER_BYTES = 16 * 1024

type MigrationBarrier = Readonly<{
  version: typeof BARRIER_VERSION
  barrierId: string
  catalogRevision: number
  committedAtMs: number
}>

export class LegacyRelayPostMigrationGc {
  private barrier: MigrationBarrier | null = null
  private tail: Promise<void> = Promise.resolve()

  private constructor(
    private readonly barrierFile: string,
    private readonly catalogRevision: () => number,
    private readonly protection: () => TerminalLegacyGcProtection,
    private readonly eligible: () => TerminalLegacyGcProtection,
    private readonly allowedRoots: readonly string[],
    private readonly quarantines: LegacyRelayGcQuarantineStore,
    private readonly fileSystem?: LegacyRelayGcFileSystem
  ) {}

  static async open(input: {
    directory: string
    catalogRevision: () => number
    protection: () => TerminalLegacyGcProtection
    eligible: () => TerminalLegacyGcProtection
    allowedRoots: readonly string[]
    fileSystem?: LegacyRelayGcFileSystem
  }): Promise<LegacyRelayPostMigrationGc> {
    await mkdir(input.directory, { recursive: true })
    const allowedRoots = await canonicalLegacyRelayGcRoots(input.allowedRoots, input.fileSystem)
    const quarantines = await LegacyRelayGcQuarantineStore.open(
      path.join(input.directory, 'quarantine-holds.json')
    )
    const coordinator = new LegacyRelayPostMigrationGc(
      path.join(input.directory, 'migration-barrier.json'),
      input.catalogRevision,
      input.protection,
      input.eligible,
      allowedRoots,
      quarantines,
      input.fileSystem
    )
    coordinator.barrier = await readBarrier(coordinator.barrierFile)
    return coordinator
  }

  commitBarrier(input: {
    barrierId: string
    expectedCatalogRevision: number
    committedAtMs?: number
  }): Promise<MigrationBarrier> {
    const operation = this.tail.then(async () => {
      const revision = this.catalogRevision()
      if (revision !== input.expectedCatalogRevision) {
        throw new Error('legacy migration catalog changed before the GC barrier')
      }
      if (this.barrier) {
        if (
          this.barrier.barrierId !== input.barrierId ||
          this.barrier.catalogRevision !== revision
        ) {
          throw new Error('legacy migration barrier identity was reused')
        }
        return this.barrier
      }
      const barrier = Object.freeze({
        version: BARRIER_VERSION,
        barrierId: input.barrierId,
        catalogRevision: revision,
        committedAtMs: input.committedAtMs ?? Date.now()
      })
      await writeBarrier(this.barrierFile, barrier)
      this.barrier = barrier
      return barrier
    })
    this.tail = operation.then(
      () => undefined,
      () => undefined
    )
    return operation
  }

  collect(input: {
    barrierId: string
  }): Promise<Readonly<{ removed: readonly string[]; protected: TerminalLegacyGcProtection }>> {
    const operation = this.tail.then(async () => {
      if (!this.barrier || this.barrier.barrierId !== input.barrierId) {
        throw new Error('legacy relay GC requires the durable migration barrier')
      }
      const removed = await this.resumeQuarantines()
      const protectedSet = this.completeProtection()
      const candidates = await eligibleLegacyRelayGcCandidates({
        eligible: this.eligible(),
        protected: protectedSet,
        allowedRoots: this.allowedRoots,
        ...(this.fileSystem ? { fileSystem: this.fileSystem } : {})
      })
      for (const candidate of candidates) {
        const hold = createLegacyRelayGcQuarantineHold(candidate, this.allowedRoots)
        await this.quarantines.add(hold)
        const result = await quarantineAndRemoveLegacyRelayGcCandidate({
          candidate,
          hold,
          allowedRoots: this.allowedRoots,
          protection: this.protection,
          ...(this.fileSystem ? { fileSystem: this.fileSystem } : {})
        })
        if (result.status !== 'preserved') {
          await this.quarantines.remove(hold.quarantinePath)
        }
        if (result.status === 'removed') {
          removed.push(candidate.reportedPath)
        }
      }
      return Object.freeze({
        removed: Object.freeze([...new Set(removed)].sort()),
        protected: this.completeProtection()
      })
    })
    this.tail = operation.then(
      () => undefined,
      () => undefined
    )
    return operation
  }

  private async resumeQuarantines(): Promise<string[]> {
    const removed: string[] = []
    for (const hold of this.quarantines.values()) {
      const candidate = this.candidateFromHold(hold)
      const result = await resumeLegacyRelayGcQuarantine({
        candidate,
        hold,
        allowedRoots: this.allowedRoots,
        protection: this.protection,
        ...(this.fileSystem ? { fileSystem: this.fileSystem } : {})
      })
      if (result.status !== 'preserved') {
        await this.quarantines.remove(hold.quarantinePath)
      }
      if (result.status === 'removed') {
        removed.push(hold.originalPath)
      }
    }
    return removed
  }

  private candidateFromHold(hold: LegacyRelayGcQuarantineHold): LegacyRelayGcCandidate {
    assertLegacyRelayGcCandidatePath(hold.originalPath, this.allowedRoots)
    assertLegacyRelayGcCandidatePath(hold.canonicalPath, this.allowedRoots)
    assertLegacyRelayGcCandidatePath(hold.quarantinePath, this.allowedRoots)
    return Object.freeze({
      reportedPath: hold.originalPath,
      removalPath: hold.canonicalPath,
      identity: hold.identity
    })
  }

  private completeProtection(): TerminalLegacyGcProtection {
    const current = this.protection()
    const relayDirectories = new Set(current.relayDirectories)
    const evidencePaths = new Set(current.evidencePaths)
    for (const hold of this.quarantines.values()) {
      const target = hold.identity.directory ? relayDirectories : evidencePaths
      target.add(hold.originalPath)
      target.add(hold.quarantinePath)
    }
    return Object.freeze({
      relayDirectories: Object.freeze([...relayDirectories].sort()),
      evidencePaths: Object.freeze([...evidencePaths].sort())
    })
  }
}

async function readBarrier(file: string): Promise<MigrationBarrier | null> {
  let encoded: Buffer
  try {
    encoded = await readFile(file)
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
      return null
    }
    throw error
  }
  if (encoded.byteLength < 1 || encoded.byteLength > MAX_BARRIER_BYTES) {
    throw new Error('legacy migration barrier is not bounded')
  }
  const value = JSON.parse(encoded.toString('utf8')) as Partial<MigrationBarrier>
  if (
    value.version !== BARRIER_VERSION ||
    typeof value.barrierId !== 'string' ||
    !value.barrierId ||
    !nonNegativeInteger(value.catalogRevision) ||
    !nonNegativeInteger(value.committedAtMs)
  ) {
    throw new Error('legacy migration barrier is invalid')
  }
  return value as MigrationBarrier
}

async function writeBarrier(file: string, barrier: MigrationBarrier): Promise<void> {
  const encoded = `${JSON.stringify(barrier)}\n`
  if (Buffer.byteLength(encoded) > MAX_BARRIER_BYTES) {
    throw new Error('legacy migration barrier exceeds its bound')
  }
  const temporary = `${file}.${process.pid}.tmp`
  try {
    const handle = await open(temporary, 'w', 0o600)
    try {
      await handle.writeFile(encoded, 'utf8')
      await handle.sync()
    } finally {
      await handle.close()
    }
    await rename(temporary, file)
  } catch (error) {
    await rm(temporary, { force: true }).catch(() => {})
    throw error
  }
  await syncDirectory(path.dirname(file))
}

async function syncDirectory(directoryPath: string): Promise<void> {
  let handle
  try {
    handle = await open(directoryPath, 'r')
    await handle.sync()
  } catch (error) {
    if (
      !['EACCES', 'EBADF', 'EINVAL', 'EISDIR', 'ENOTSUP', 'EPERM'].includes(
        (error as NodeJS.ErrnoException).code ?? ''
      )
    ) {
      throw error
    }
  } finally {
    await handle?.close()
  }
}

function nonNegativeInteger(value: unknown): boolean {
  return Number.isSafeInteger(value) && Number(value) >= 0
}
