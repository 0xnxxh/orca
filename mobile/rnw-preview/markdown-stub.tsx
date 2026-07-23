import { createElement } from 'react'
import { Text } from 'react-native'

export function MobileMarkdown({ content }: { content: string }): React.JSX.Element {
  return createElement(Text, { style: { color: '#e0e0e0', fontSize: 16 } }, content)
}
