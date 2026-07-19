import { useCallback, useRef, useState } from 'react'
import {
  ActivityIndicator,
  BackHandler,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View
} from 'react-native'
import { useFocusEffect, useLocalSearchParams, useRouter } from 'expo-router'
import { SafeAreaView } from 'react-native-safe-area-context'
import { MessageSquare } from 'lucide-react-native'
import { OrcaLogo } from '../src/components/OrcaLogo'
import { saveDefaultSessionView } from '../src/storage/session-view-preferences'
import type { MobileSessionView } from '../src/storage/session-view-preferences'
import { colors, radii, spacing, typography } from '../src/theme/mobile-theme'

export default function SessionViewOptInScreen() {
  const router = useRouter()
  const params = useLocalSearchParams<{ hostId?: string | string[] }>()
  const hostId = Array.isArray(params.hostId) ? params.hostId[0] : params.hostId
  const [busyChoice, setBusyChoice] = useState<MobileSessionView | null>(null)
  const [error, setError] = useState<string | null>(null)
  const choiceInFlightRef = useRef(false)

  // Why: this one-time screen requires an explicit terminal/chat choice; disabling
  // back gestures alone would still leave Android hardware back open.
  useFocusEffect(
    useCallback(() => {
      const subscription = BackHandler.addEventListener('hardwareBackPress', () => true)
      return () => subscription.remove()
    }, [])
  )

  const continueToApp = useCallback(() => {
    router.replace(hostId ? `/h/${hostId}` : '/')
  }, [hostId, router])

  const choose = useCallback(
    async (view: MobileSessionView) => {
      // Why: state does not disable both buttons synchronously, so a ref prevents
      // rapid taps from persisting two conflicting defaults and navigating twice.
      if (choiceInFlightRef.current) {
        return
      }
      choiceInFlightRef.current = true
      setBusyChoice(view)
      setError(null)
      try {
        // Why: persisting either choice makes the default key present, which the
        // opt-in gate reads as "decided" so this screen never shows again.
        await saveDefaultSessionView(view)
        continueToApp()
      } catch {
        setError('Your choice could not be saved. Try again.')
        setBusyChoice(null)
        choiceInFlightRef.current = false
      }
    },
    [continueToApp]
  )

  return (
    <SafeAreaView style={styles.container}>
      <ScrollView contentContainerStyle={styles.scrollContent} showsVerticalScrollIndicator={false}>
        <View style={styles.brandRow}>
          <OrcaLogo size={22} />
          <Text style={styles.brandName}>Orca</Text>
        </View>

        <View style={styles.content}>
          <View style={styles.iconSurface}>
            <MessageSquare size={30} color={colors.textPrimary} />
          </View>
          <Text style={styles.eyebrow}>Native chat</Text>
          <Text style={styles.title}>Pick your session view</Text>
          <Text style={styles.body}>
            Choose how Claude, Codex, and other chat-capable agents open on this device. Native chat
            shows a chat interface like the desktop app; terminal shows the raw CLI. You can switch
            any session from its long-press menu.
          </Text>
        </View>

        <View style={styles.footer}>
          {error ? (
            <Text style={styles.error} accessibilityRole="alert">
              {error}
            </Text>
          ) : null}
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Open sessions in native chat"
            disabled={busyChoice !== null}
            style={({ pressed }) => [
              styles.primaryButton,
              pressed && styles.buttonPressed,
              busyChoice !== null && styles.buttonDisabled
            ]}
            onPress={() => void choose('chat')}
          >
            {busyChoice === 'chat' ? (
              <ActivityIndicator color={colors.bgBase} />
            ) : (
              <Text style={styles.primaryButtonText}>Use native chat</Text>
            )}
          </Pressable>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Open sessions in the terminal"
            disabled={busyChoice !== null}
            style={({ pressed }) => [
              styles.secondaryButton,
              pressed && styles.buttonPressed,
              busyChoice !== null && styles.buttonDisabled
            ]}
            onPress={() => void choose('terminal')}
          >
            {busyChoice === 'terminal' ? (
              <ActivityIndicator color={colors.textSecondary} />
            ) : (
              <Text style={styles.secondaryButtonText}>Keep terminal</Text>
            )}
          </Pressable>
          <Text style={styles.footerNote}>You can change this any time in Settings.</Text>
        </View>
      </ScrollView>
    </SafeAreaView>
  )
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: colors.bgBase,
    paddingHorizontal: spacing.xl
  },
  // Why: this decision screen cannot be dismissed with Back, so every action
  // must remain reachable in landscape and with accessibility text scaling.
  scrollContent: {
    flexGrow: 1
  },
  brandRow: {
    minHeight: 52,
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm
  },
  brandName: {
    color: colors.textPrimary,
    fontSize: 17,
    fontWeight: '700'
  },
  content: {
    flexGrow: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: spacing.xl
  },
  iconSurface: {
    width: 64,
    height: 64,
    borderRadius: radii.card,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.bgRaised,
    marginBottom: spacing.xl
  },
  eyebrow: {
    color: colors.textMuted,
    fontSize: 11,
    fontWeight: '600',
    letterSpacing: 0.55,
    textTransform: 'uppercase',
    marginBottom: spacing.sm
  },
  title: {
    maxWidth: 420,
    color: colors.textPrimary,
    fontSize: 26,
    fontWeight: '700',
    letterSpacing: -0.3,
    textAlign: 'center'
  },
  body: {
    maxWidth: 420,
    color: colors.textSecondary,
    fontSize: typography.bodySize,
    lineHeight: 21,
    textAlign: 'center',
    marginTop: spacing.md
  },
  footer: {
    width: '100%',
    maxWidth: 420,
    alignSelf: 'center',
    paddingBottom: spacing.lg
  },
  primaryButton: {
    minHeight: 44,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: radii.button,
    backgroundColor: colors.surfaceBright,
    paddingVertical: spacing.sm
  },
  primaryButtonText: {
    color: colors.bgBase,
    fontSize: typography.bodySize,
    fontWeight: '600'
  },
  secondaryButton: {
    minHeight: 44,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: radii.button,
    marginTop: spacing.xs,
    paddingVertical: spacing.sm
  },
  secondaryButtonText: {
    color: colors.textSecondary,
    fontSize: typography.bodySize,
    fontWeight: '500'
  },
  buttonPressed: {
    opacity: 0.72
  },
  buttonDisabled: {
    opacity: 0.58
  },
  footerNote: {
    color: colors.textMuted,
    fontSize: typography.metaSize,
    lineHeight: 18,
    textAlign: 'center',
    marginTop: spacing.sm
  },
  error: {
    color: colors.statusRed,
    fontSize: typography.metaSize,
    lineHeight: 18,
    textAlign: 'center',
    marginBottom: spacing.sm
  }
})
