import { ActivityIndicator, Pressable, Text } from 'react-native'
import { colors } from '../theme/mobile-theme'
import { styles } from './mobile-native-chat-view-styles'

/** "Load earlier messages" list header: spinner while a page is in flight, an
 *  error + tap-to-retry affordance when the last page failed. */
export function MobileNativeChatLoadEarlierHeader({
  loadingEarlier,
  loadEarlierError,
  onLoadEarlier
}: {
  loadingEarlier?: boolean
  loadEarlierError?: string | null
  onLoadEarlier?: () => void
}): React.JSX.Element {
  return (
    <Pressable style={styles.loadEarlier} onPress={onLoadEarlier} disabled={loadingEarlier}>
      {loadingEarlier ? (
        <ActivityIndicator size="small" color={colors.textMuted} />
      ) : loadEarlierError ? (
        <>
          <Text style={styles.loadEarlierErrorText}>{loadEarlierError}</Text>
          <Text style={styles.loadEarlierRetryText}>Tap to retry</Text>
        </>
      ) : (
        <Text style={styles.loadEarlierText}>Load earlier messages</Text>
      )}
    </Pressable>
  )
}
