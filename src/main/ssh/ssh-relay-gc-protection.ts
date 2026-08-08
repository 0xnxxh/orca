import { remoteBasename, type RemoteHostPlatform } from './ssh-remote-platform'

export function protectedRelayDirectoryNames(
  options: {
    protectedRelayDir?: string
    protectedRelayDirs?: readonly string[]
  },
  host: RemoteHostPlatform
): ReadonlySet<string> {
  return new Set(
    [options.protectedRelayDir, ...(options.protectedRelayDirs ?? [])]
      .filter((value): value is string => Boolean(value))
      .map((value) => remoteBasename(value, host))
      .map((value) => (host.pathFlavor === 'windows' ? value.toLowerCase() : value))
  )
}
