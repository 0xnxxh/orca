import { useEffect, useState } from 'react'
import { ActivityIndicator, Pressable, Text, View } from 'react-native'
import { colors } from '../theme/mobile-theme'
import { hybridShellStyles as styles } from './hybrid-shell-styles'

type RecoveryAction = 'retry' | 'previous' | 'clear' | 'hosts'

type MobileWebRecoveryActionsProps = {
  canUsePrevious: boolean
  onRetry: () => void | Promise<void>
  onUsePrevious: () => void | Promise<void>
  onClearCache: () => void | Promise<void>
  onShowHosts: () => void | Promise<void>
  onFailure: () => void
}

export function MobileWebRecoveryActions({
  canUsePrevious,
  onRetry,
  onUsePrevious,
  onClearCache,
  onShowHosts,
  onFailure
}: MobileWebRecoveryActionsProps) {
  const [busyAction, setBusyAction] = useState<RecoveryAction>()
  const [showBusy, setShowBusy] = useState(false)

  useEffect(() => {
    setShowBusy(false)
    if (!busyAction) {
      return
    }
    const timer = setTimeout(() => setShowBusy(true), 200)
    return () => clearTimeout(timer)
  }, [busyAction])

  const run = async (action: RecoveryAction, operation: () => void | Promise<void>) => {
    if (busyAction) {
      return
    }
    setBusyAction(action)
    try {
      await operation()
    } catch {
      onFailure()
    } finally {
      setBusyAction(undefined)
    }
  }

  const actions = [
    { id: 'retry' as const, label: 'Retry', operation: onRetry },
    ...(canUsePrevious
      ? [{ id: 'previous' as const, label: 'Use previous', operation: onUsePrevious }]
      : []),
    { id: 'clear' as const, label: 'Clear cache', operation: onClearCache },
    { id: 'hosts' as const, label: 'Switch hosts', operation: onShowHosts }
  ]

  return (
    <View accessibilityRole="toolbar" style={styles.recoveryActions}>
      {actions.map((action) => (
        <Pressable
          key={action.id}
          accessibilityLabel={`${action.label} workspace interface`}
          accessibilityRole="button"
          accessibilityState={{ disabled: Boolean(busyAction) }}
          disabled={Boolean(busyAction)}
          style={({ pressed }) => [
            styles.recoveryButton,
            pressed && styles.recoveryButtonPressed,
            busyAction && styles.recoveryButtonDisabled
          ]}
          onPress={() => void run(action.id, action.operation)}
        >
          {busyAction === action.id && showBusy ? (
            <ActivityIndicator color={colors.textSecondary} size="small" />
          ) : null}
          <Text style={styles.recoveryButtonText}>{action.label}</Text>
        </Pressable>
      ))}
    </View>
  )
}
