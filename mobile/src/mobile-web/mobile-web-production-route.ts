export function isRetiredNativeWorkspaceRoute(pathname: string): boolean {
  return pathname === '/h' || pathname.startsWith('/h/')
}
