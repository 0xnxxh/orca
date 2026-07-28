import { Component, type ErrorInfo, type ReactNode } from 'react'
import { Pressable, StyleSheet, Text, View } from 'react-native'

import { mobileWebRouteFailureCode } from '../src/mobile-web/mobile-web-route-failure-code'
import { colors, radii, spacing, typography } from '../src/theme/mobile-theme'

type MobileWebRouteErrorBoundaryProps = {
  children: ReactNode
}

type MobileWebRouteErrorBoundaryState = {
  failureCode: string | null
}

export class MobileWebRouteErrorBoundary extends Component<
  MobileWebRouteErrorBoundaryProps,
  MobileWebRouteErrorBoundaryState
> {
  state: MobileWebRouteErrorBoundaryState = { failureCode: null }

  static getDerivedStateFromError(error: unknown): MobileWebRouteErrorBoundaryState {
    return {
      failureCode: mobileWebRouteFailureCode(error)
    }
  }

  componentDidCatch(error: unknown, info: ErrorInfo): void {
    console.error('[mobile-web] hosted route stopped', {
      code: mobileWebRouteFailureCode(error),
      componentDepth: info.componentStack?.split('\n').length ?? 0
    })
  }

  render() {
    if (!this.state.failureCode) {
      return this.props.children
    }
    return (
      <View style={styles.container}>
        <Text style={styles.title}>Workspace view stopped</Text>
        <Text style={styles.message}>
          Reload the desktop-served interface to reconnect. Diagnostic: {this.state.failureCode}
        </Text>
        <Pressable style={styles.button} onPress={() => window.location.reload()}>
          <Text style={styles.buttonText}>Reload interface</Text>
        </Pressable>
      </View>
    )
  }
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.md,
    padding: spacing.xl,
    backgroundColor: colors.bgBase
  },
  title: {
    color: colors.textPrimary,
    fontSize: typography.titleSize,
    fontWeight: '700'
  },
  message: {
    color: colors.textSecondary,
    fontSize: typography.bodySize,
    lineHeight: 20,
    textAlign: 'center'
  },
  button: {
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.sm,
    borderRadius: radii.button,
    backgroundColor: colors.bgRaised
  },
  buttonText: {
    color: colors.textPrimary,
    fontSize: typography.bodySize,
    fontWeight: '600'
  }
})
