import type { MobilePairingConnectionMode } from '../../shared/mobile-pairing-connection-mode'
import type { DeviceScope } from '../../shared/runtime-types'
import type { RuntimePairingReach } from '../../shared/runtime-pairing-reach'
import type { DeviceEntry } from './device-registry'
import type { RelayDeviceBinding } from './relay/relay-revoke-outbox'

export function parseOrdinaryDevices(parsed: unknown): DeviceEntry[] {
  if (!Array.isArray(parsed)) {
    throw new Error('Device registry is invalid')
  }
  return parsed.map((device) => {
    if (!device || typeof device !== 'object') {
      throw new Error('Device registry is invalid')
    }
    const entry = device as DeviceEntry
    return {
      ...entry,
      // Why: older registries only existed for phone pairing. Treat missing scope as mobile.
      scope: entry.scope === 'runtime' ? 'runtime' : 'mobile',
      relayBinding: validRelayBinding(entry.relayBinding, entry.deviceId),
      mobilePairingConnectionMode:
        entry.mobilePairingConnectionMode === 'local-only' ? 'local-only' : 'automatic',
      // Why: missing reach predates off-host pairing and must retain network behavior.
      pairingReach: entry.pairingReach === 'this-computer' ? 'this-computer' : 'network'
    }
  })
}

export function parseStrictDevices(parsed: unknown): DeviceEntry[] {
  if (!Array.isArray(parsed)) {
    throw new Error('Device registry is invalid')
  }
  const ids = new Set<string>()
  const tokens = new Set<string>()
  return parsed.map((value) => {
    if (!value || typeof value !== 'object' || Array.isArray(value)) {
      throw new Error('Device registry is invalid')
    }
    const entry = value as Partial<DeviceEntry>
    const scope = entry.scope === undefined ? 'mobile' : entry.scope
    const mode = entry.mobilePairingConnectionMode ?? 'automatic'
    const reach = entry.pairingReach ?? 'network'
    if (
      !boundedText(entry.deviceId, 256) ||
      !boundedText(entry.name, 256) ||
      !boundedText(entry.token, 512) ||
      !isDeviceScope(scope) ||
      !finiteTimestamp(entry.pairedAt) ||
      !finiteTimestamp(entry.lastSeenAt) ||
      !isPairingMode(mode) ||
      !isPairingReach(reach)
    ) {
      throw new Error('Device registry is invalid')
    }
    if (ids.has(entry.deviceId) || tokens.has(entry.token)) {
      throw new Error('Device registry is invalid')
    }
    ids.add(entry.deviceId)
    tokens.add(entry.token)
    const relayBinding = strictRelayBinding(entry.relayBinding, entry.deviceId)
    return {
      deviceId: entry.deviceId,
      name: entry.name,
      token: entry.token,
      scope,
      pairedAt: entry.pairedAt,
      lastSeenAt: entry.lastSeenAt,
      ...(relayBinding ? { relayBinding } : {}),
      mobilePairingConnectionMode: mode,
      pairingReach: reach
    }
  })
}

function validRelayBinding(value: unknown, deviceId: string): RelayDeviceBinding | undefined {
  if (!value || typeof value !== 'object') {
    return undefined
  }
  const binding = value as Partial<RelayDeviceBinding>
  return binding.relayDeviceId === deviceId &&
    typeof binding.relayHostId === 'string' &&
    typeof binding.ownerIdentityKey === 'string'
    ? {
        relayHostId: binding.relayHostId,
        relayDeviceId: binding.relayDeviceId,
        ownerIdentityKey: binding.ownerIdentityKey,
        ...(typeof binding.inviteExpiresAt === 'number' && Number.isFinite(binding.inviteExpiresAt)
          ? { inviteExpiresAt: binding.inviteExpiresAt }
          : {})
      }
    : undefined
}

function strictRelayBinding(value: unknown, deviceId: string): RelayDeviceBinding | undefined {
  if (value === undefined) {
    return undefined
  }
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error('Device registry is invalid')
  }
  const binding = value as Partial<RelayDeviceBinding>
  if (
    binding.relayDeviceId !== deviceId ||
    !boundedText(binding.relayHostId, 256) ||
    !boundedText(binding.ownerIdentityKey, 1024) ||
    (binding.inviteExpiresAt !== undefined && !finiteTimestamp(binding.inviteExpiresAt))
  ) {
    throw new Error('Device registry is invalid')
  }
  return {
    relayHostId: binding.relayHostId,
    relayDeviceId: binding.relayDeviceId,
    ownerIdentityKey: binding.ownerIdentityKey,
    ...(binding.inviteExpiresAt !== undefined ? { inviteExpiresAt: binding.inviteExpiresAt } : {})
  }
}

function boundedText(value: unknown, maxLength: number): value is string {
  return typeof value === 'string' && value.length > 0 && value.length <= maxLength
}

function finiteTimestamp(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0
}

function isDeviceScope(value: unknown): value is DeviceScope {
  return value === 'mobile' || value === 'runtime'
}

function isPairingMode(value: unknown): value is MobilePairingConnectionMode {
  return value === 'automatic' || value === 'local-only'
}

function isPairingReach(value: unknown): value is RuntimePairingReach {
  return value === 'network' || value === 'this-computer'
}
