export function getMobileTerminalHotSetRouteSafetyFailure(args: {
  initialScopeKey: string
  scopeKey: string
  handles: readonly string[]
  activeHandle: string | null
  activeTerminalHandleExpected: boolean
}): string | null {
  if (args.initialScopeKey !== args.scopeKey) {
    return 'route-reused'
  }
  if (args.activeTerminalHandleExpected && args.activeHandle == null && args.handles.length > 0) {
    return 'missing-active-handle'
  }
  if (args.activeHandle != null && !args.handles.includes(args.activeHandle)) {
    return 'stale-activation-generation'
  }
  return null
}
