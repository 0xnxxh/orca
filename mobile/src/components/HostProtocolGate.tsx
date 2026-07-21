import type { ReactNode } from 'react'
import { useHostClient } from '../transport/client-context'
import { useHostStatusGates } from '../transport/host-status-gates'
import { ProtocolBlockScreen } from './ProtocolBlockScreen'

type Props = {
  hostId: string | undefined
  children: ReactNode
}

// Why: single choke point above every /h/[hostId] route so a blocked verdict replaces the
// whole host UI (sidebar + detail stack) while the host list and other hosts stay usable.
export function HostProtocolGate({ hostId, children }: Props) {
  const { client, state } = useHostClient(hostId)
  const { compatVerdict } = useHostStatusGates({ hostId, client, connState: state })
  if (compatVerdict.kind === 'blocked') {
    return <ProtocolBlockScreen verdict={compatVerdict} />
  }
  return <>{children}</>
}
