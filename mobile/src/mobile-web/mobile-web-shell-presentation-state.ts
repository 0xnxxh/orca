export type MobileWebShellPresentationState =
  | 'host-picker'
  | 'package-loading'
  | 'package-unavailable'
  | 'hosted-interface'

export type MobileWebHostPickerPresentationState = 'loading' | 'failed' | 'empty' | 'ready'

export function mobileWebShellPresentationState(args: {
  hasSelectedHost: boolean
  hasSession: boolean
  packageLoading: boolean
}): MobileWebShellPresentationState {
  if (!args.hasSelectedHost) {
    return 'host-picker'
  }
  if (args.hasSession) {
    return 'hosted-interface'
  }
  return args.packageLoading ? 'package-loading' : 'package-unavailable'
}

export function mobileWebShellShowsNativeChrome(state: MobileWebShellPresentationState): boolean {
  return state !== 'hosted-interface'
}

export function mobileWebHostPickerPresentationState(args: {
  loading: boolean
  failed: boolean
  hostCount: number
}): MobileWebHostPickerPresentationState {
  if (args.loading) {
    return 'loading'
  }
  if (args.failed) {
    return 'failed'
  }
  return args.hostCount === 0 ? 'empty' : 'ready'
}
