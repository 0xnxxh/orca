import { mkdir } from 'node:fs/promises'
import path from 'node:path'
import {
  assertAuthorityId,
  assertAuthorityStoragePath,
  type TerminalAuthorityWriterIdentity
} from '../../shared/terminal-session-authority-identity'
import { failTerminalSessionAuthority } from '../../shared/terminal-session-authority-mutation'
import {
  acquireTerminalAuthorityWriterGuard,
  clearTerminalAuthorityWriterGuard,
  readTerminalAuthorityWriterGuardOwner,
  readTerminalAuthorityWriterMarker,
  releaseTerminalAuthorityWriterGuard,
  removeTerminalAuthorityWriterCrashFiles,
  writeTerminalAuthorityWriterMarker,
  type TerminalAuthorityWriterMarker
} from './terminal-authority-writer-storage'

export type TerminalAuthorityWriterLockOptions = Readonly<{
  directory: string
  ownerToken: string
  /** The caller must prove the predecessor process is dead before supplying this token. */
  takeoverOwnerToken?: string
  /** Allows takeover of a crash guard written before its first marker. */
  allowUninitializedTakeover?: boolean
}>

export type TerminalAuthorityWriterClaim = Readonly<{
  markerOwnerToken: string | null
  guardOwnerToken: string | null
}>

export class TerminalAuthorityWriterLock {
  readonly identity: TerminalAuthorityWriterIdentity
  readonly replacedOwnerToken: string | null
  private released = false

  private constructor(
    private readonly directory: string,
    marker: TerminalAuthorityWriterMarker,
    replacedOwnerToken: string | null
  ) {
    this.identity = Object.freeze({ ownerToken: marker.ownerToken, epoch: marker.epoch })
    this.replacedOwnerToken = replacedOwnerToken
  }

  static async acquire(
    options: TerminalAuthorityWriterLockOptions
  ): Promise<TerminalAuthorityWriterLock> {
    assertAuthorityStoragePath(options.directory, 'writer lock directory')
    assertAuthorityId(options.ownerToken, 'writer ownerToken')
    if (options.takeoverOwnerToken !== undefined) {
      assertAuthorityId(options.takeoverOwnerToken, 'takeover ownerToken')
    }
    const directory = path.resolve(options.directory)
    await mkdir(directory, { recursive: true })
    if (options.takeoverOwnerToken) {
      await clearProvenStaleGuard(
        directory,
        options.takeoverOwnerToken,
        options.allowUninitializedTakeover === true
      )
    }
    const guard = await acquireTerminalAuthorityWriterGuard(directory, options.ownerToken)
    let marker: TerminalAuthorityWriterMarker
    let previous: TerminalAuthorityWriterMarker | null
    try {
      await removeTerminalAuthorityWriterCrashFiles(directory)
      previous = await readTerminalAuthorityWriterMarker(directory)
      marker = nextWriterMarker(previous, options)
      await writeTerminalAuthorityWriterMarker(directory, marker)
    } catch (error) {
      await releaseTerminalAuthorityWriterGuard(directory, guard)
      throw error
    }
    await releaseTerminalAuthorityWriterGuard(directory, guard)
    return new TerminalAuthorityWriterLock(
      directory,
      marker,
      previous?.active ? previous.ownerToken : null
    )
  }

  static async readCurrentOwnerToken(directory: string): Promise<string | null> {
    const claim = await this.readCurrentOwnerClaim(directory)
    return claim.guardOwnerToken ?? claim.markerOwnerToken
  }

  static async readCurrentOwnerClaim(directory: string): Promise<TerminalAuthorityWriterClaim> {
    assertAuthorityStoragePath(directory, 'writer lock directory')
    const resolved = path.resolve(directory)
    const marker = await readTerminalAuthorityWriterMarker(resolved)
    return Object.freeze({
      markerOwnerToken: marker?.active ? marker.ownerToken : null,
      guardOwnerToken: await readTerminalAuthorityWriterGuardOwner(resolved)
    })
  }

  static async clearProvenGuard(directory: string, ownerToken: string): Promise<boolean> {
    assertAuthorityStoragePath(directory, 'writer lock directory')
    assertAuthorityId(ownerToken, 'writer guard ownerToken')
    return clearTerminalAuthorityWriterGuard(path.resolve(directory), ownerToken)
  }

  async runExclusive<T>(operation: () => Promise<T>): Promise<T> {
    if (this.released) {
      failTerminalSessionAuthority('writer-fenced', 'authority writer lock is released')
    }
    const guard = await acquireTerminalAuthorityWriterGuard(
      this.directory,
      this.identity.ownerToken
    )
    try {
      const current = await readTerminalAuthorityWriterMarker(this.directory)
      if (
        !current?.active ||
        current.ownerToken !== this.identity.ownerToken ||
        current.epoch !== this.identity.epoch
      ) {
        failTerminalSessionAuthority('writer-fenced', 'authority writer was replaced')
      }
      return await operation()
    } finally {
      await releaseTerminalAuthorityWriterGuard(this.directory, guard)
    }
  }

  async release(): Promise<void> {
    if (this.released) {
      return
    }
    await this.runExclusive(async () => {
      await writeTerminalAuthorityWriterMarker(this.directory, {
        version: 1,
        ownerToken: this.identity.ownerToken,
        epoch: this.identity.epoch,
        active: false
      })
    })
    this.released = true
  }
}

function nextWriterMarker(
  previous: TerminalAuthorityWriterMarker | null,
  options: TerminalAuthorityWriterLockOptions
): TerminalAuthorityWriterMarker {
  if (!previous) {
    // A registry takeover opens namespace stores lazily; an untouched namespace has no marker.
    return Object.freeze({ version: 1, ownerToken: options.ownerToken, epoch: 1, active: true })
  }
  if (previous.active && previous.ownerToken !== options.takeoverOwnerToken) {
    failTerminalSessionAuthority('writer-fenced', 'another authority writer is active')
  }
  return Object.freeze({
    version: 1,
    ownerToken: options.ownerToken,
    epoch: previous.epoch + 1,
    active: true
  })
}

async function clearProvenStaleGuard(
  directory: string,
  takeoverOwnerToken: string,
  allowUninitializedTakeover: boolean
): Promise<void> {
  const marker = await readTerminalAuthorityWriterMarker(directory)
  const guardOwnerToken = await readTerminalAuthorityWriterGuardOwner(directory)
  if (
    guardOwnerToken === takeoverOwnerToken &&
    ((marker?.active && marker.ownerToken === takeoverOwnerToken) ||
      (!marker && allowUninitializedTakeover))
  ) {
    await clearTerminalAuthorityWriterGuard(directory, takeoverOwnerToken)
  }
}
