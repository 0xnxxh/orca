import { useCallback, useRef } from 'react'
import {
  ActivityIndicator,
  FlatList,
  Platform,
  Text,
  View,
  type NativeScrollEvent,
  type NativeSyntheticEvent
} from 'react-native'
import type { NativeChatMessage } from '../../../src/shared/native-chat-types'
import { colors } from '../theme/mobile-theme'
import { MobileNativeChatMessage } from './MobileNativeChatMessage'
import {
  admitStructuredOlderPage,
  beginStructuredUserScroll,
  createMobileStructuredPaginationState,
  finishStructuredPaginationMomentum,
  settleStructuredOlderPage
} from './mobile-structured-history-pagination'
import { styles } from './mobile-structured-agent-session-view-styles'

type Props = {
  messages: NativeChatMessage[]
  status: 'idle' | 'loading' | 'ready' | 'error'
  error?: string
  hasOlder: boolean
  loadingOlder: boolean
  onLoadOlder: () => Promise<boolean>
  onOpenFile?: (path: string) => void
}

export function MobileStructuredAgentSessionView(props: Props): React.JSX.Element {
  const listRef = useRef<FlatList<NativeChatMessage>>(null)
  const paginationRef = useRef(createMobileStructuredPaginationState())
  const priorContentHeightRef = useRef(0)
  const androidAnchorOffsetRef = useRef(0)
  const data = props.messages.toReversed()

  const loadOlder = useCallback(() => {
    const pagination = paginationRef.current
    if (!props.hasOlder || props.loadingOlder || !admitStructuredOlderPage(pagination)) {
      return
    }
    void props.onLoadOlder().finally(() => settleStructuredOlderPage(pagination))
  }, [props])

  const onScroll = useCallback((event: NativeSyntheticEvent<NativeScrollEvent>) => {
    androidAnchorOffsetRef.current = event.nativeEvent.contentOffset.y
  }, [])

  if (props.status === 'loading' && data.length === 0) {
    return (
      <View style={styles.center}>
        <ActivityIndicator color={colors.textSecondary} />
      </View>
    )
  }

  return (
    <View style={styles.root}>
      <FlatList
        ref={listRef}
        inverted
        data={data}
        keyExtractor={(item) => item.id}
        renderItem={({ item, index }) => (
          <MobileNativeChatMessage
            message={item}
            messageIndex={data.length - index - 1}
            onOpenFile={props.onOpenFile}
          />
        )}
        contentContainerStyle={styles.content}
        maintainVisibleContentPosition={
          Platform.OS === 'android' ? undefined : { minIndexForVisible: 0 }
        }
        onScroll={onScroll}
        scrollEventThrottle={32}
        onScrollBeginDrag={() => beginStructuredUserScroll(paginationRef.current)}
        onMomentumScrollBegin={() => {
          if (!paginationRef.current.programmaticMomentum) {
            paginationRef.current.userMomentum = true
          }
        }}
        onMomentumScrollEnd={() => {
          const pagination = paginationRef.current
          finishStructuredPaginationMomentum(pagination, !pagination.programmaticMomentum)
        }}
        onEndReached={loadOlder}
        onEndReachedThreshold={0.2}
        onContentSizeChange={(_width, height) => {
          const priorHeight = priorContentHeightRef.current
          priorContentHeightRef.current = height
          if (Platform.OS !== 'android' || priorHeight === 0 || height <= priorHeight) {
            return
          }
          paginationRef.current.programmaticMomentum = true
          listRef.current?.scrollToOffset({
            offset: androidAnchorOffsetRef.current + height - priorHeight,
            animated: false
          })
        }}
        ListFooterComponent={
          props.loadingOlder ? (
            <View style={styles.loader}>
              <ActivityIndicator size="small" color={colors.textMuted} />
            </View>
          ) : null
        }
        ListEmptyComponent={
          <View style={styles.center}>
            <Text style={styles.title}>
              {props.status === 'error' ? 'Conversation unavailable' : 'New Codex chat'}
            </Text>
            <Text style={styles.subtitle}>{props.error ?? 'Messages will appear here.'}</Text>
          </View>
        }
      />
      <View style={styles.readOnlyBanner}>
        <Text style={styles.readOnlyText}>Read only · sending arrives in the next update</Text>
      </View>
    </View>
  )
}
