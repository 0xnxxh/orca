import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { ActivityIndicator, Pressable, StyleSheet, Text, View } from 'react-native'
import { useRouter } from 'expo-router'
import { ChevronLeft, MonitorSmartphone } from 'lucide-react-native'
import WebView, { type WebViewMessageEvent } from 'react-native-webview'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import type { MobileWebPrototypeResponse } from '../../src/shared/mobile-web-prototype-contract'
import {
  parseMobileWebPrototypeRequest,
  sanitizeMobileWebPrototypeWorkspaces
} from '../src/hybrid-prototype/mobile-web-prototype-bridge'
import {
  loadCachedMobileWebPrototypePackage,
  saveMobileWebPrototypePackage
} from '../src/hybrid-prototype/mobile-web-prototype-cache'
import {
  downloadMobileWebPrototypePackage,
  type VerifiedMobileWebPrototypePackage
} from '../src/hybrid-prototype/mobile-web-prototype-package'
import { MobileWebHostPicker } from '../src/mobile-web/MobileWebHostPicker'
import { triggerSelection } from '../src/platform/haptics'
import { colors, spacing, typography } from '../src/theme/mobile-theme'
import { useHostClient } from '../src/transport/client-context'
import { loadHosts } from '../src/transport/host-store'

const DOCUMENT_ORIGIN = 'https://mobile-web-prototype.orca.invalid'
const DOCUMENT_URL = `${DOCUMENT_ORIGIN}/index.html`

type PrototypeHost = { id: string; name: string; lastConnected: number }

export default function HybridPrototypeScreen() {
  const router = useRouter()
  const insets = useSafeAreaInsets()
  const webViewRef = useRef<WebView>(null)
  const webReadyRef = useRef(false)
  const activeHostIdRef = useRef<string | undefined>(undefined)
  const [hosts, setHosts] = useState<PrototypeHost[]>([])
  const [hostsLoading, setHostsLoading] = useState(true)
  const [hostLoadError, setHostLoadError] = useState(false)
  const [selectedHostId, setSelectedHostId] = useState<string>()
  const [prototypePackage, setPrototypePackage] =
    useState<VerifiedMobileWebPrototypePackage | null>(null)
  const [packageLoading, setPackageLoading] = useState(false)
  const [packageWarning, setPackageWarning] = useState<string>()
  const { client, state } = useHostClient(selectedHostId)
  const selectedHost = useMemo(
    () => hosts.find((host) => host.id === selectedHostId),
    [hosts, selectedHostId]
  )
  activeHostIdRef.current = selectedHostId

  const refreshHosts = useCallback(async () => {
    setHostsLoading(true)
    setHostLoadError(false)
    try {
      const loaded = await loadHosts()
      setHosts(loaded.map(({ id, name, lastConnected }) => ({ id, name, lastConnected })))
    } catch {
      setHostLoadError(true)
    } finally {
      setHostsLoading(false)
    }
  }, [])

  useEffect(() => {
    void refreshHosts()
  }, [refreshHosts])

  useEffect(() => {
    if (!selectedHostId) {
      setPrototypePackage(null)
      setPackageWarning(undefined)
      return
    }
    let cancelled = false
    setPackageLoading(true)
    setPackageWarning(undefined)

    void (async () => {
      const cached = await loadCachedMobileWebPrototypePackage(selectedHostId)
      if (!cancelled && cached) {
        setPrototypePackage(cached)
        setPackageLoading(false)
      }
      if (!client || state !== 'connected') {
        if (!cancelled) {
          setPackageLoading(false)
          if (!cached) {
            setPackageWarning('Connect to this desktop to load its prototype UI.')
          }
        }
        return
      }
      try {
        const downloaded = await downloadMobileWebPrototypePackage((method, params) =>
          client.sendRequest(method, params)
        )
        if (cancelled) {
          return
        }
        setPrototypePackage(downloaded)
        setPackageLoading(false)
        try {
          await saveMobileWebPrototypePackage(selectedHostId, downloaded)
        } catch {
          if (!cancelled) {
            setPackageWarning('The verified UI loaded, but its offline cache could not be updated.')
          }
        }
      } catch {
        if (!cancelled) {
          setPackageLoading(false)
          setPackageWarning(
            cached
              ? 'Using the last verified UI because the desktop package could not be refreshed.'
              : 'The desktop did not provide a valid prototype UI.'
          )
        }
      }
    })()

    return () => {
      cancelled = true
    }
  }, [client, selectedHostId, state])

  const postToWeb = useCallback((message: MobileWebPrototypeResponse) => {
    webViewRef.current?.postMessage(JSON.stringify(message))
  }, [])

  const postInit = useCallback(() => {
    if (!selectedHost || !prototypePackage) {
      return
    }
    postToWeb({
      v: 1,
      type: 'init',
      buildId: prototypePackage.manifest.buildId,
      host: { id: selectedHost.id, name: selectedHost.name },
      connection: state,
      capabilities: ['workspace.list', 'haptic.selection']
    })
  }, [postToWeb, prototypePackage, selectedHost, state])

  useEffect(() => {
    if (webReadyRef.current) {
      postToWeb({ v: 1, type: 'connection', state })
    }
  }, [postToWeb, state])

  const handleWebMessage = useCallback(
    async (event: WebViewMessageEvent) => {
      const request = parseMobileWebPrototypeRequest(event.nativeEvent.data)
      if (!request) {
        return
      }
      if (request.type === 'ready') {
        webReadyRef.current = true
        postInit()
        return
      }
      if (request.type === 'haptic.selection') {
        triggerSelection()
        postToWeb({ v: 1, type: 'response', id: request.id, ok: true, result: null })
        return
      }
      if (!client || state !== 'connected') {
        postToWeb({
          v: 1,
          type: 'response',
          id: request.id,
          ok: false,
          error: 'The paired desktop is not connected.'
        })
        return
      }
      try {
        const requestHostId = selectedHostId
        const response = await client.sendRequest('worktree.ps', { limit: 10000 })
        // Why: a slow SSH/Relay response must not cross into a newly selected host's document.
        if (activeHostIdRef.current !== requestHostId) {
          return
        }
        if (!response.ok) {
          throw new Error('workspace_request_failed')
        }
        postToWeb({
          v: 1,
          type: 'response',
          id: request.id,
          ok: true,
          result: { workspaces: sanitizeMobileWebPrototypeWorkspaces(response.result) }
        })
      } catch {
        postToWeb({
          v: 1,
          type: 'response',
          id: request.id,
          ok: false,
          error: 'Workspace request failed.'
        })
      }
    },
    [client, postInit, postToWeb, selectedHostId, state]
  )

  const handleBack = useCallback(() => {
    if (selectedHostId) {
      setSelectedHostId(undefined)
      webReadyRef.current = false
      return
    }
    router.back()
  }, [router, selectedHostId])

  const selectHost = useCallback((hostId: string) => {
    webReadyRef.current = false
    setPrototypePackage(null)
    setSelectedHostId(hostId)
  }, [])

  const isAllowedNavigation = useCallback((request: { url?: string }) => {
    const url = request.url ?? ''
    return url === 'about:blank' || url === DOCUMENT_URL || url.startsWith(`${DOCUMENT_URL}#`)
  }, [])

  return (
    <View style={[styles.container, { paddingTop: insets.top }]}>
      <View style={styles.header}>
        <Pressable
          accessibilityLabel="Back"
          hitSlop={8}
          style={styles.headerButton}
          onPress={handleBack}
        >
          <ChevronLeft size={22} color={colors.textSecondary} />
        </Pressable>
        <View style={styles.headerCopy}>
          <Text numberOfLines={1} style={styles.heading}>
            {selectedHost?.name ?? 'Hybrid UI prototype'}
          </Text>
          <Text style={styles.headerMeta}>Experimental desktop-served UI</Text>
        </View>
        {selectedHost ? (
          <Pressable style={styles.hostsButton} onPress={() => setSelectedHostId(undefined)}>
            <Text style={styles.hostsButtonText}>Hosts</Text>
          </Pressable>
        ) : null}
      </View>

      {!selectedHost ? (
        <MobileWebHostPicker
          hosts={hosts}
          loading={hostsLoading}
          failed={hostLoadError}
          onRetry={() => void refreshHosts()}
          onSelect={selectHost}
        />
      ) : prototypePackage ? (
        <View style={styles.webContainer}>
          {packageWarning ? <Text style={styles.warning}>{packageWarning}</Text> : null}
          <WebView
            key={prototypePackage.manifest.buildId}
            ref={webViewRef}
            source={{ html: prototypePackage.html, baseUrl: DOCUMENT_URL }}
            originWhitelist={[DOCUMENT_ORIGIN, 'about:blank']}
            javaScriptEnabled
            domStorageEnabled={false}
            allowFileAccess={false}
            allowUniversalAccessFromFileURLs={false}
            mixedContentMode="never"
            setSupportMultipleWindows={false}
            javaScriptCanOpenWindowsAutomatically={false}
            onLoadStart={() => {
              webReadyRef.current = false
            }}
            onMessage={(event) => void handleWebMessage(event)}
            onShouldStartLoadWithRequest={isAllowedNavigation}
            onContentProcessDidTerminate={() => webViewRef.current?.reload()}
            onRenderProcessGone={() => webViewRef.current?.reload()}
            style={styles.webView}
          />
        </View>
      ) : (
        <View style={styles.loadingState}>
          {packageLoading ? (
            <ActivityIndicator color={colors.textSecondary} />
          ) : (
            <MonitorSmartphone size={26} color={colors.textMuted} />
          )}
          <Text style={styles.loadingTitle}>
            {packageLoading ? 'Loading desktop UI…' : 'Prototype unavailable'}
          </Text>
          {packageWarning ? <Text style={styles.loadingBody}>{packageWarning}</Text> : null}
        </View>
      )}
    </View>
  )
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.bgBase },
  header: {
    minHeight: 58,
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: spacing.sm,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: colors.borderSubtle,
    backgroundColor: colors.bgPanel
  },
  headerButton: { width: 38, height: 38, alignItems: 'center', justifyContent: 'center' },
  headerCopy: { flex: 1, minWidth: 0 },
  heading: { color: colors.textPrimary, fontSize: 16, fontWeight: '600' },
  headerMeta: { color: colors.textMuted, fontSize: 11, marginTop: 1 },
  hostsButton: { paddingHorizontal: spacing.md, paddingVertical: spacing.sm },
  hostsButtonText: {
    color: colors.textSecondary,
    fontSize: typography.metaSize,
    fontWeight: '600'
  },
  webContainer: { flex: 1, minHeight: 0 },
  webView: { flex: 1, backgroundColor: colors.bgBase },
  warning: {
    color: colors.textSecondary,
    backgroundColor: colors.bgRaised,
    fontSize: typography.metaSize,
    lineHeight: 17,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm
  },
  loadingState: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.sm,
    paddingHorizontal: spacing.xl
  },
  loadingTitle: { color: colors.textPrimary, fontSize: typography.bodySize, fontWeight: '600' },
  loadingBody: {
    color: colors.textSecondary,
    fontSize: typography.metaSize,
    lineHeight: 18,
    textAlign: 'center'
  }
})
