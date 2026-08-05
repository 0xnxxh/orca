import { createContext, useContext, useRef, type ReactNode } from 'react'
import { ActivityIndicator, StyleSheet, View } from 'react-native'
import { useHostClient } from '../transport/client-context'
import { useHostStatusGates, type HostStatusGates } from '../transport/host-status-gates'
import { colors } from '../theme/mobile-theme'
import { ProtocolBlockScreen } from './ProtocolBlockScreen'

type Props = {
  hostId: string | undefined
  children: ReactNode
}

const HostStatusGatesContext = createContext<HostStatusGates | null>(null)

export function useHostProtocolGates(): HostStatusGates {
  const gates = useContext(HostStatusGatesContext)
  if (!gates) {
    throw new Error('useHostProtocolGates must be used inside <HostProtocolGate>')
  }
  return gates
}

// Why: single choke point above every /h/[hostId] route so a blocked verdict replaces the
// whole host UI (sidebar + detail stack) while the host list and other hosts stay usable.
export function HostProtocolGate({ hostId, children }: Props) {
  const { client, state } = useHostClient(hostId)
  const gates = useHostStatusGates({ hostId, client, connState: state })
  const { compatVerdict, statusPending } = gates
  const resolvedHostIdRef = useRef<string | null>(null)
  const mountedHostIdRef = useRef<string | null>(null)
  const hostKey = hostId ?? null
  if (state === 'connected' && client && !statusPending) {
    resolvedHostIdRef.current = hostKey
  }
  const pending = statusPending && resolvedHostIdRef.current !== hostKey
  if (pending && mountedHostIdRef.current !== hostKey) {
    // Why: nothing is mounted yet for this host, so hold the routes back entirely
    // rather than letting them mount (and fire their connect RPCs) pre-verdict.
    return (
      <View style={styles.pending}>
        <ActivityIndicator
          color={colors.textSecondary}
          accessibilityLabel="Checking host compatibility"
        />
      </View>
    )
  }
  if (compatVerdict.kind === 'blocked') {
    // Why: the block screen unmounts the routes, so a later pending window must not
    // assume a live tree it can overlay.
    mountedHostIdRef.current = null
    return <ProtocolBlockScreen verdict={compatVerdict} />
  }
  mountedHostIdRef.current = hostKey
  // Why: the host sidebar needs the same status fields; sharing the result avoids a second status.get per route.
  return (
    <HostStatusGatesContext.Provider value={gates}>
      <View style={styles.host}>
        {children}
        {pending ? (
          // Why: once the stack is mounted, unmounting it for a pending status.get destroys
          // in-flight nested navigation, so cover it instead. Mount effects underneath still
          // run — they wait for connState 'connected' and every capability-dependent call
          // re-probes status.get itself, so nothing newer than the baseline fires here.
          <View
            style={styles.pendingOverlay}
            // Why: an opaque absolute fill owns the hit test, so taps never reach the stack.
            pointerEvents="auto"
            accessibilityViewIsModal
          >
            <ActivityIndicator
              color={colors.textSecondary}
              accessibilityLabel="Checking host compatibility"
            />
          </View>
        ) : null}
      </View>
    </HostStatusGatesContext.Provider>
  )
}

const styles = StyleSheet.create({
  pending: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.bgBase
  },
  // Stays mounted across the overlay toggling so the routes below keep their identity.
  host: {
    flex: 1
  },
  pendingOverlay: {
    ...StyleSheet.absoluteFillObject,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.bgBase,
    zIndex: 1000,
    elevation: 1000
  }
})
