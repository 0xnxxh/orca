import { Alert } from 'react-native'

export function showForceReconnectError(error: unknown): void {
  Alert.alert('Unable to reconnect', error instanceof Error ? error.message : 'Please try again.')
}
