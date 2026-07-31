import { useMemo } from 'react'
import { Text, View } from 'react-native'
import { splitMobileNativeChatLongText } from './mobile-native-chat-long-text'
import { styles, TEXT_SIZE } from './mobile-native-chat-message-styles'

export function MobileNativeChatLongText({
  content,
  fontScale
}: {
  content: string
  fontScale: number
}): React.JSX.Element {
  const chunks = useMemo(() => splitMobileNativeChatLongText(content), [content])
  return (
    <View>
      {chunks.map((chunk) => (
        <Text
          key={chunk.start}
          style={[styles.longTextPlain, { fontSize: TEXT_SIZE * fontScale }]}
          selectable
        >
          {chunk.text}
        </Text>
      ))}
    </View>
  )
}
