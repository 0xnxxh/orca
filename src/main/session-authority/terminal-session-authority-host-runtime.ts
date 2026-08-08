import { randomUUID } from 'node:crypto'
import { mkdir } from 'node:fs/promises'
import path from 'node:path'
import {
  assertAuthorityId,
  assertAuthorityStoragePath
} from '../../shared/terminal-session-authority-identity'
import { readOrCreateTerminalAuthorityHostId } from './terminal-session-authority-host-identity'
import {
  terminalAuthorityOwnerProcessIsGone,
  type TerminalAuthorityOwnerProcessIdentity
} from './terminal-session-authority-owner-process'
import {
  assertTerminalAuthorityOwnerProcessIdentity,
  encodeTerminalAuthorityOwnerToken,
  parseTerminalAuthorityOwnerToken,
  type TerminalAuthorityOwnerProof
} from './terminal-session-authority-owner-token'
import { TerminalSessionAuthorityPtyOwner } from './terminal-session-authority-pty-owner'
import { TerminalSessionAuthorityRegistry } from './terminal-session-authority-registry'
import { openTerminalAuthorityWriterWithRecovery } from './terminal-authority-writer-recovery'
import type { TerminalSessionAuthorityHostEffectApplier } from './terminal-session-authority-host-effect-applier'

export type TerminalSessionAuthorityHostRuntimeOptions = Readonly<{
  directory: string
  processIdentity: TerminalAuthorityOwnerProcessIdentity
  hostEffectApplier?: TerminalSessionAuthorityHostEffectApplier
  createId?: () => string
  predecessorIsGone?: (proof: TerminalAuthorityOwnerProof) => Promise<boolean>
}>

export class TerminalSessionAuthorityHostRuntime {
  readonly authorityHostId: string
  readonly ownerIncarnationId: string
  readonly ptyOwner: TerminalSessionAuthorityPtyOwner
  private closed = false

  private constructor(
    private readonly registry: TerminalSessionAuthorityRegistry,
    authorityHostId: string,
    ownerIncarnationId: string
  ) {
    this.authorityHostId = authorityHostId
    this.ownerIncarnationId = ownerIncarnationId
    this.ptyOwner = new TerminalSessionAuthorityPtyOwner({
      registry,
      ownerIncarnationId
    })
  }

  static async open(
    options: TerminalSessionAuthorityHostRuntimeOptions
  ): Promise<TerminalSessionAuthorityHostRuntime> {
    assertAuthorityStoragePath(options.directory, 'authority host runtime directory')
    assertTerminalAuthorityOwnerProcessIdentity(options.processIdentity)
    const directory = path.resolve(options.directory)
    await mkdir(directory, { recursive: true })
    const createId = options.createId ?? randomUUID
    const authorityHostId = await readOrCreateTerminalAuthorityHostId(directory, createId)
    const ownerNonce = createId()
    const ownerIncarnationId = createId()
    assertAuthorityId(ownerNonce, 'authority owner nonce')
    assertAuthorityId(ownerIncarnationId, 'ownerIncarnationId')
    const ownerToken = encodeTerminalAuthorityOwnerToken(ownerNonce, {
      ownerIncarnationId,
      process: Object.freeze({ ...options.processIdentity })
    })
    const predecessorIsGone =
      options.predecessorIsGone ?? ((proof) => terminalAuthorityOwnerProcessIsGone(proof.process))
    const claimIsGone = async (candidate: string): Promise<boolean> => {
      const proof = parseTerminalAuthorityOwnerToken(candidate)
      return proof ? await predecessorIsGone(proof) : false
    }
    const registryDirectory = path.join(directory, 'registry')
    const openRegistry = (takeoverOwnerToken?: string) =>
      TerminalSessionAuthorityRegistry.open({
        directory: registryDirectory,
        authorityHostId,
        ownerToken,
        ownerIncarnationId,
        writerActorId: `pty-owner:${authorityHostId}`,
        writerClaimIsGone: claimIsGone,
        ...(takeoverOwnerToken ? { takeoverOwnerToken } : {})
      })
    const registry = await openTerminalAuthorityWriterWithRecovery({
      directory: registryDirectory,
      open: openRegistry,
      claimIsGone
    })
    const runtime = new TerminalSessionAuthorityHostRuntime(
      registry,
      authorityHostId,
      ownerIncarnationId
    )
    if (options.hostEffectApplier) {
      runtime.ptyOwner.installHostEffectApplier(options.hostEffectApplier)
    }
    await runtime.ptyOwner.start()
    return runtime
  }

  async close(): Promise<void> {
    if (this.closed) {
      return
    }
    this.closed = true
    this.ptyOwner.dispose()
    await this.registry.close()
  }
}
