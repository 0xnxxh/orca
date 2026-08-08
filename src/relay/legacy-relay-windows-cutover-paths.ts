import { win32 } from 'node:path'
import type { LegacyRelayPublicEndpointFenceIdentity } from './legacy-relay-public-endpoint-fence'

export type WindowsLegacyRelayCutoverPaths = Readonly<{
  activePipeMarkerPath: string
  privateActivePipeMarkerPath: string
  publicCredentialFile: string
  privateCredentialFile: string
  privateStateDirectory: string
}>

export function validateWindowsLegacyRelayCutoverPaths(
  input: WindowsLegacyRelayCutoverPaths & Readonly<{ pipeName: string }>
): WindowsLegacyRelayCutoverPaths {
  assertWindowsLegacyRelayPipeName(input.pipeName)
  const paths = {
    activePipeMarkerPath: resolveWindowsAbsolute(input.activePipeMarkerPath),
    privateActivePipeMarkerPath: resolveWindowsAbsolute(input.privateActivePipeMarkerPath),
    publicCredentialFile: resolveWindowsAbsolute(input.publicCredentialFile),
    privateCredentialFile: resolveWindowsAbsolute(input.privateCredentialFile),
    privateStateDirectory: resolveWindowsAbsolute(input.privateStateDirectory)
  }
  if (new Set(Object.values(paths).map((value) => value.toLowerCase())).size !== 5) {
    throw new Error('legacy relay Windows cutover paths must be distinct')
  }
  assertWindowsPrivateChild(paths.privateStateDirectory, paths.privateActivePipeMarkerPath)
  assertWindowsPrivateChild(paths.privateStateDirectory, paths.privateCredentialFile)
  const privateRoot = win32.parse(paths.privateStateDirectory).root.toLowerCase()
  if (
    win32.parse(paths.activePipeMarkerPath).root.toLowerCase() !== privateRoot ||
    win32.parse(paths.publicCredentialFile).root.toLowerCase() !== privateRoot
  ) {
    throw new Error('legacy relay Windows state cannot be sealed across volumes')
  }
  return Object.freeze(paths)
}

export function windowsLegacyRelayPublicFenceIdentities(
  paths: WindowsLegacyRelayCutoverPaths,
  pipeName: string,
  processCreationMarker: string
): Readonly<{
  credential: LegacyRelayPublicEndpointFenceIdentity
  marker: LegacyRelayPublicEndpointFenceIdentity
}> {
  const endpointIdentity = `${canonicalWindowsLegacyRelayPipeName(pipeName)}:${processCreationMarker}`
  return Object.freeze({
    credential: Object.freeze({
      role: 'credential',
      endpointIdentity,
      privatePath: paths.privateCredentialFile
    }),
    marker: Object.freeze({
      role: 'active-pipe-marker',
      endpointIdentity,
      privatePath: paths.privateActivePipeMarkerPath
    })
  })
}

export function assertWindowsLegacyRelayPipeName(value: string): void {
  if (!/^\\\\[.?]\\pipe\\.+$/i.test(value) || value.includes('\0') || value.length > 256) {
    throw new Error('legacy relay Windows pipe name is invalid')
  }
}

export function canonicalWindowsLegacyRelayPipeName(value: string): string {
  assertWindowsLegacyRelayPipeName(value)
  return win32.normalize(value).toLowerCase()
}

function resolveWindowsAbsolute(value: string): string {
  if (!win32.isAbsolute(value) || value.includes('\0')) {
    throw new Error('legacy relay Windows cutover path must be absolute')
  }
  return win32.resolve(value)
}

function assertWindowsPrivateChild(directory: string, child: string): void {
  const pathFromDirectory = win32.relative(directory, child)
  if (
    !pathFromDirectory ||
    pathFromDirectory.startsWith('..') ||
    win32.isAbsolute(pathFromDirectory)
  ) {
    throw new Error('legacy relay Windows private path escapes authority state')
  }
}
