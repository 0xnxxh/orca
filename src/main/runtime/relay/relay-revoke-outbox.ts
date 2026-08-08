import { randomUUID } from 'node:crypto'
import { existsSync, lstatSync, readFileSync, statSync } from 'node:fs'
import { join } from 'node:path'
import {
  assertSecureRegularFile,
  hardenExistingSecureFile,
  writeSecureJsonFile
} from '../../../shared/secure-file'
import { RELAY_REVOKE_OUTBOX_FILENAME } from '../mobile-pairing-files'

export type RelayDeviceBinding = {
  relayHostId: string
  relayDeviceId: string
  ownerIdentityKey: string
  inviteExpiresAt?: number
}

export type RelayRevokeOutboxItem = RelayDeviceBinding & {
  reqId: string
  createdAt: number
}

const MAX_OUTBOX_FILE_BYTES = 256 * 1024

export { RELAY_REVOKE_OUTBOX_FILENAME }

type RelayRevokeOutboxLoadOptions = {
  strict?: boolean
}

function isItem(value: unknown): value is RelayRevokeOutboxItem {
  if (!value || typeof value !== 'object') {
    return false
  }
  const item = value as Partial<RelayRevokeOutboxItem>
  return (
    typeof item.reqId === 'string' &&
    typeof item.relayHostId === 'string' &&
    typeof item.relayDeviceId === 'string' &&
    typeof item.ownerIdentityKey === 'string' &&
    (item.inviteExpiresAt === undefined ||
      (typeof item.inviteExpiresAt === 'number' && Number.isFinite(item.inviteExpiresAt))) &&
    typeof item.createdAt === 'number' &&
    Number.isFinite(item.createdAt)
  )
}

function isStrictItem(value: unknown): value is RelayRevokeOutboxItem {
  if (!isItem(value)) {
    return false
  }
  return (
    boundedText(value.reqId, 128) &&
    boundedText(value.relayHostId, 256) &&
    boundedText(value.relayDeviceId, 256) &&
    boundedText(value.ownerIdentityKey, 1024) &&
    finiteTimestamp(value.createdAt) &&
    (value.inviteExpiresAt === undefined || finiteTimestamp(value.inviteExpiresAt))
  )
}

export class RelayRevokeOutbox {
  private readonly path: string
  private items: RelayRevokeOutboxItem[]

  constructor(userDataPath: string, options: RelayRevokeOutboxLoadOptions = {}) {
    this.path = join(userDataPath, RELAY_REVOKE_OUTBOX_FILENAME)
    this.items = this.load(options.strict === true)
  }

  enqueue(binding: RelayDeviceBinding): RelayRevokeOutboxItem {
    const existing = this.items.find(
      (item) =>
        item.relayHostId === binding.relayHostId &&
        item.relayDeviceId === binding.relayDeviceId &&
        item.ownerIdentityKey === binding.ownerIdentityKey
    )
    if (existing) {
      return existing
    }
    const item = { ...binding, reqId: randomUUID(), createdAt: Date.now() }
    const next = [...this.items, item]
    this.save(next)
    this.items = next
    return item
  }

  pendingFor(ownerIdentityKey: string, relayHostId: string): readonly RelayRevokeOutboxItem[] {
    return this.items.filter(
      (item) => item.ownerIdentityKey === ownerIdentityKey && item.relayHostId === relayHostId
    )
  }

  /** Returns the bounded durable queue for the ordered identity reset phase. */
  listPending(): readonly RelayRevokeOutboxItem[] {
    return this.items
  }

  /** Makes an empty queue durable before a reset transaction records its intent. */
  ensureDurable(): void {
    this.save(this.items)
  }

  remove(reqId: string): void {
    const next = this.items.filter((item) => item.reqId !== reqId)
    if (next.length === this.items.length) {
      return
    }
    this.save(next)
    this.items = next
  }

  private load(strict: boolean): RelayRevokeOutboxItem[] {
    if (strict) {
      try {
        lstatSync(this.path)
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
          throw new Error('Relay revoke outbox is missing')
        }
        throw new Error('Relay revoke outbox is unavailable')
      }
    } else if (!existsSync(this.path)) {
      return []
    }
    try {
      if (strict) {
        assertSecureRegularFile(this.path, 'Relay revoke outbox')
      }
      hardenExistingSecureFile(this.path)
      if (strict && statSync(this.path).size > MAX_OUTBOX_FILE_BYTES) {
        throw new Error('Relay revoke outbox is too large')
      }
      const parsed: unknown = JSON.parse(readFileSync(this.path, 'utf-8'))
      if (!Array.isArray(parsed)) {
        throw new Error('Relay revoke outbox is invalid')
      }
      if (strict) {
        const reqIds = new Set<string>()
        const bindings = new Set<string>()
        for (const item of parsed) {
          if (!isStrictItem(item)) {
            throw new Error('Relay revoke outbox is invalid')
          }
          const bindingKey = `${item.relayHostId}\0${item.relayDeviceId}\0${item.ownerIdentityKey}`
          if (reqIds.has(item.reqId) || bindings.has(bindingKey)) {
            throw new Error('Relay revoke outbox is invalid')
          }
          reqIds.add(item.reqId)
          bindings.add(bindingKey)
        }
      }
      return parsed.filter(isItem)
    } catch (error) {
      if (strict) {
        if (error instanceof Error && error.message.startsWith('Relay revoke outbox')) {
          throw error
        }
        throw new Error('Relay revoke outbox is invalid')
      }
      return []
    }
  }

  private save(items: readonly RelayRevokeOutboxItem[]): void {
    writeSecureJsonFile(this.path, items)
  }
}

function boundedText(value: unknown, maxLength: number): value is string {
  return typeof value === 'string' && value.length > 0 && value.length <= maxLength
}

function finiteTimestamp(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0
}

/** Strict reset loader kept separate from ordinary fail-open relay cleanup. */
export function loadRelayRevokeOutboxForReset(userDataPath: string): RelayRevokeOutbox {
  return new RelayRevokeOutbox(userDataPath, { strict: true })
}
