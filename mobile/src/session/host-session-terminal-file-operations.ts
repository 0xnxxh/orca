export type HostSessionTerminalFileTarget =
  | {
      kind: 'worktree-file'
      relativePath: string
      localAbsolutePath: string | null
    }
  | {
      kind: 'native-artifact'
      absolutePath: string
      grantId: string
    }
  | {
      kind: 'web-artifact'
      token: string
      displayName: string
      previewKind: 'text' | 'raster'
    }

export type HostSessionTerminalFileResolveRequest = {
  workspaceId: string
  tabId: string
  terminalHandle: string
  pathText: string
  cwd: string | null
  line: number | null
  column: number | null
}

export type HostSessionTerminalFileOperations = {
  resolveTerminalPath(
    request: HostSessionTerminalFileResolveRequest
  ): Promise<HostSessionTerminalFileTarget | null>
  openWorktreeFile(workspaceId: string, relativePath: string): Promise<void>
}
