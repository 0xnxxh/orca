import React, { useState } from 'react'
import type { MobileWebWorkspaceSummary } from '../../shared/mobile-web/bridge-operation-contract'
import { MobileWebSession } from './mobile-web-session'
import { MobileWebNativeShellProvider, useMobileWebNativeShell } from './native-shell-channel'
import { MobileWebWorkspaces } from './mobile-web-workspaces'

export function MobileWebShell(): React.JSX.Element {
  return (
    <MobileWebNativeShellProvider>
      <MobileWebShellContent />
    </MobileWebNativeShellProvider>
  )
}

function MobileWebShellContent(): React.JSX.Element {
  const shell = useMobileWebNativeShell()
  const key = shell.context ? `${shell.context.shellSessionId}:${shell.context.buildId}` : 'opening'
  return (
    <main className="h-dvh overflow-y-auto bg-background text-foreground scrollbar-sleek">
      <MobileWebHostApplication key={key} client={shell.client} connection={shell.connection} />
    </main>
  )
}

function MobileWebHostApplication({
  client,
  connection
}: Pick<ReturnType<typeof useMobileWebNativeShell>, 'client' | 'connection'>): React.JSX.Element {
  const [workspace, setWorkspace] = useState<MobileWebWorkspaceSummary | null>(null)

  if (workspace && client) {
    return (
      <MobileWebSession
        client={client}
        connection={connection}
        workspace={workspace}
        onBack={() => setWorkspace(null)}
      />
    )
  }
  return (
    <MobileWebWorkspaces
      client={client}
      connection={connection}
      onOpen={(nextWorkspace) => {
        void client?.native.hapticSelection().catch(() => null)
        setWorkspace(nextWorkspace)
      }}
    />
  )
}
