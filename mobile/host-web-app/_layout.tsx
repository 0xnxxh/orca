import { Stack } from 'expo-router'
import { StyleSheet, View } from 'react-native'
import { GestureHandlerRootView } from 'react-native-gesture-handler'
import { SafeAreaProvider } from 'react-native-safe-area-context'

import { MobileWebNativeShellProvider } from '../../src/mobile-web/src/native-shell-channel'
import { installMobileWebHistorySessionFragment } from '../src/mobile-web/mobile-web-history-session-fragment'
import { colors } from '../src/theme/mobile-theme'
import { RpcClientProvider } from '../src/transport/client-context'
import { MobileWebRouteErrorBoundary } from './mobile-web-route-error-boundary'
import { MobileWebRouteRestorer } from './mobile-web-route-restorer'

installMobileWebHistorySessionFragment()

export default function HostMobileWebLayout() {
  return (
    <GestureHandlerRootView style={styles.root}>
      <SafeAreaProvider>
        <RpcClientProvider>
          <MobileWebNativeShellProvider>
            <MobileWebRouteRestorer />
            <View style={styles.root}>
              <MobileWebRouteErrorBoundary>
                <Stack screenOptions={{ headerShown: false }} />
              </MobileWebRouteErrorBoundary>
            </View>
          </MobileWebNativeShellProvider>
        </RpcClientProvider>
      </SafeAreaProvider>
    </GestureHandlerRootView>
  )
}

const styles = StyleSheet.create({
  root: {
    flex: 1,
    backgroundColor: colors.bgBase
  }
})
