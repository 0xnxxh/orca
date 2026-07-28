import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import {
  activateHostedWebViewControl,
  isHostedMobileWebUrl,
  readHostedWebViewState,
  readHostedWebViewTextPoint,
  selectVisibleHostedWebView,
  setHostedWebViewInput,
  startHostedWebViewConnectionObservation,
  terminateHostedWebViewProcess,
  waitForHostedWebViewConnectionSequence,
  verifyHostedWebViewNavigationIsolation,
  verifyHostedWebViewNetworkIsolation
} from '../../scripts/hosted-webview-cdp-session.mjs'

const iosShellSource = readFileSync(
  new URL('../../packages/expo-mobile-web-shell/ios/MobileWebShellView.swift', import.meta.url),
  'utf8'
)
const androidShellSource = readFileSync(
  new URL(
    '../../packages/expo-mobile-web-shell/android/src/main/java/expo/modules/mobilewebshell/MobileWebShellView.kt',
    import.meta.url
  ),
  'utf8'
)
const androidProbeSource = readFileSync(
  new URL(
    '../../packages/expo-mobile-web-shell/android/src/main/java/expo/modules/mobilewebshell/MobileWebDebugIsolationProbe.kt',
    import.meta.url
  ),
  'utf8'
)
const expoLogBoxPatch = readFileSync(
  new URL('../../patches/@expo__log-box@55.0.12.patch', import.meta.url),
  'utf8'
)
const expoDomWebViewPatch = readFileSync(
  new URL('../../patches/@expo__dom-webview@55.0.5.patch', import.meta.url),
  'utf8'
)
const reactNativeWebViewPatch = readFileSync(
  new URL('../../patches/react-native-webview@13.16.1.patch', import.meta.url),
  'utf8'
)
const simulatorHarnessSource = readFileSync(
  new URL('../../scripts/run-hosted-webview-simulator-e2e.mjs', import.meta.url),
  'utf8'
)
const simulatorAppBuildSource = readFileSync(
  new URL('../../scripts/hosted-ios-simulator-app-build.mjs', import.meta.url),
  'utf8'
)
const androidSecurityHarnessSource = readFileSync(
  new URL('../../scripts/run-hosted-android-webview-security-e2e.mjs', import.meta.url),
  'utf8'
)
const androidReleaseHarnessSource = readFileSync(
  new URL('../../scripts/verify-hosted-android-release-webview.mjs', import.meta.url),
  'utf8'
)
const androidCrashLoopHarnessSource = readFileSync(
  new URL('../../scripts/run-hosted-android-webview-crash-loop.mjs', import.meta.url),
  'utf8'
)

function probe(overrides: Record<string, unknown> = {}) {
  return {
    targetId: 'target-a',
    href: 'orca-mobile-web://session-a/',
    visibility: 'visible',
    focused: true,
    bridgeListening: true,
    bodyText: 'mobile-rearch',
    buttonCount: 3,
    ...overrides
  }
}

describe('hosted WebView CDP target selection', () => {
  it('recognizes only the platform private asset origins', () => {
    expect(isHostedMobileWebUrl('orca-mobile-web://session-a/')).toBe(true)
    expect(isHostedMobileWebUrl('https://orca-mobile-web.invalid/#session-a')).toBe(true)
    expect(isHostedMobileWebUrl('https://orca-mobile-web.invalid.evil.test/')).toBe(false)
    expect(isHostedMobileWebUrl('http://orca-mobile-web.invalid/')).toBe(false)
  })

  it('selects only a visible interactive hosted document with expected UI text', () => {
    expect(
      selectVisibleHostedWebView(
        [
          probe({ href: 'https://untrusted.example/' }),
          probe({ visibility: 'hidden' }),
          probe({ bridgeListening: false }),
          probe({ bodyText: 'another workspace' }),
          probe()
        ],
        'mobile-rearch'
      )
    ).toMatchObject({ targetId: 'target-a' })
  })

  it('prefers the focused generation when WebKit briefly reports two visible documents', () => {
    expect(
      selectVisibleHostedWebView(
        [probe({ targetId: 'old', focused: false }), probe({ targetId: 'current', focused: true })],
        'mobile-rearch'
      )
    ).toMatchObject({ targetId: 'current' })
  })

  it('rejects a document without user-observable controls', () => {
    expect(selectVisibleHostedWebView([probe({ buttonCount: 0 })], 'mobile-rearch')).toBeNull()
  })

  it('can select a ready terminal document without raw DOM buttons', () => {
    expect(
      selectVisibleHostedWebView(
        [probe({ buttonCount: 0, href: 'orca-mobile-web://session-a/h/host/session/worktree' })],
        'mobile-rearch',
        '/session/',
        false
      )
    ).toMatchObject({ targetId: 'target-a' })
  })

  it('can require the visible document to be on the expected route', () => {
    expect(
      selectVisibleHostedWebView(
        [
          probe({
            href: 'orca-mobile-web://session-a/h/host/agent-history/worktree'
          }),
          probe({
            href: 'orca-mobile-web://session-a/h/host/session/worktree'
          })
        ],
        'mobile-rearch',
        '/session/'
      )
    ).toMatchObject({
      href: 'orca-mobile-web://session-a/h/host/session/worktree'
    })
  })

  it('starts the document probe and requires its completion marker', async () => {
    const socket = new FakeCdpSocket(['probe-a', 'probe-a'])
    const result = await verifyHostedWebViewNetworkIsolation({
      document: {
        webSocketDebuggerUrl: 'ws://127.0.0.1/devtools/page/current'
      },
      probeId: 'probe-a',
      settleDelayMs: 0,
      WebSocketCtor: class {
        constructor() {
          return socket
        }
      }
    })

    expect(result).toEqual({
      fetch: 'attempted',
      xhr: 'attempted',
      webSocket: 'attempted',
      image: 'attempted'
    })
    expect(socket.evaluations).toHaveLength(2)
    const expressions = socket.evaluations
      .map((evaluation) => evaluation.params.expression)
      .join('\n')
    expect(expressions).toContain('__orcaRunSecurityProbe')
    expect(expressions).toContain('__orcaDebugNetworkProbeCompletion')
  })

  it('requires an exact probe token', async () => {
    await expect(
      verifyHostedWebViewNetworkIsolation({
        document: {
          webSocketDebuggerUrl: 'ws://127.0.0.1/devtools/page/current'
        },
        probeId: ''
      })
    ).rejects.toThrow('token is unavailable')
  })

  it('requires all adversarial navigation attempts to fail closed', async () => {
    const socket = new FakeCdpSocket([
      JSON.stringify({
        token: 'probe-a',
        documentRetained: true,
        popupBlocked: true,
        serviceWorkerBlocked: true,
        redirectFrameAttempted: true,
        downloadAttempted: true,
        externalSchemeAttempted: true
      })
    ])
    const result = await verifyHostedWebViewNavigationIsolation({
      document: {
        webSocketDebuggerUrl: 'ws://127.0.0.1/devtools/page/current'
      },
      probeId: 'probe-a',
      settleDelayMs: 0,
      WebSocketCtor: class {
        constructor() {
          return socket
        }
      }
    })

    expect(result).toEqual({
      documentRetained: true,
      popupBlocked: true,
      serviceWorkerBlocked: true,
      redirectFrameAttempted: true,
      downloadAttempted: true,
      externalSchemeAttempted: true
    })
    expect(socket.evaluations[0]?.params.expression).toContain(
      '__orcaDebugNavigationProbeCompletion'
    )
  })

  it('reads a normalized hosted text landmark', async () => {
    const socket = new FakeCdpSocket([JSON.stringify({ x: 0.25, y: 0.125 })])

    await expect(
      readHostedWebViewTextPoint(
        { webSocketDebuggerUrl: 'ws://127.0.0.1/devtools/page/current' },
        'Agent Session History',
        fakeCdpConstructor(socket),
        { ignoreCase: true, occurrence: 1 }
      )
    ).resolves.toEqual({ x: 0.25, y: 0.125 })
    expect(socket.evaluations[0]?.params.expression).toContain('getBoundingClientRect')
    expect(socket.evaluations[0]?.params.expression).toContain("style.visibility !== 'hidden'")
    expect(socket.evaluations[0]?.params.expression).toContain('toLocaleLowerCase')
    expect(socket.evaluations[0]?.params.expression).toContain('matches[1]')
  })

  it('rejects incomplete adversarial navigation evidence', async () => {
    const socket = new FakeCdpSocket([
      JSON.stringify({
        token: 'probe-a',
        documentRetained: true,
        popupBlocked: false
      })
    ])
    await expect(
      verifyHostedWebViewNavigationIsolation({
        document: {
          webSocketDebuggerUrl: 'ws://127.0.0.1/devtools/page/current'
        },
        probeId: 'probe-a',
        settleDelayMs: 0,
        WebSocketCtor: class {
          constructor() {
            return socket
          }
        }
      })
    ).rejects.toThrow('navigation isolation failed')
  })

  it('accepts an Android popup proxy only without a second page target', async () => {
    const socket = new FakeCdpSocket([
      JSON.stringify({
        token: 'probe-a',
        documentRetained: true,
        popupBlocked: false,
        serviceWorkerBlocked: true,
        redirectFrameAttempted: true,
        downloadAttempted: true,
        externalSchemeAttempted: true
      })
    ])
    const fetchImpl = async () =>
      new Response(
        JSON.stringify([
          {
            id: 'current',
            type: 'page',
            url: 'https://orca-mobile-web.invalid/#session',
            webSocketDebuggerUrl: 'ws://127.0.0.1/devtools/page/current'
          }
        ])
      )

    await expect(
      verifyHostedWebViewNavigationIsolation({
        document: {
          targetId: 'current',
          webSocketDebuggerUrl: 'ws://127.0.0.1/devtools/page/current'
        },
        discoveryUrl: 'http://127.0.0.1:9222',
        probeId: 'probe-a',
        settleDelayMs: 0,
        WebSocketCtor: class {
          constructor() {
            return socket
          }
        },
        fetchImpl
      })
    ).resolves.toMatchObject({ popupBlocked: true })
  })

  it('reads bounded UI facts and activates controls without page-owned selectors', async () => {
    const socket = new FakeCdpSocket([
      JSON.stringify({
        href: 'orca-mobile-web://session-a/',
        bodyText: 'Agent Session History',
        labels: ['Back', 'Refresh agent sessions'],
        placeholders: ['Search sessions, repo:, path:']
      }),
      JSON.stringify({ found: true }),
      JSON.stringify({ activated: true }),
      JSON.stringify({ updated: true }),
      JSON.stringify({ found: true }),
      JSON.stringify({ activated: true })
    ])
    const document = {
      webSocketDebuggerUrl: 'ws://127.0.0.1/devtools/page/current'
    }

    await expect(
      readHostedWebViewState(document, fakeCdpConstructor(socket))
    ).resolves.toMatchObject({
      bodyText: 'Agent Session History',
      labels: ['Back', 'Refresh agent sessions']
    })
    await expect(
      activateHostedWebViewControl(
        document,
        { kind: 'label', value: 'More session actions', reveal: true },
        fakeCdpConstructor(socket)
      )
    ).resolves.toBeUndefined()
    await expect(
      setHostedWebViewInput(
        document,
        { placeholder: 'Search sessions, repo:, path:', value: 'fixture' },
        fakeCdpConstructor(socket)
      )
    ).resolves.toBeUndefined()
    await expect(
      activateHostedWebViewControl(
        document,
        { kind: 'text', value: 'mobile-rearch' },
        fakeCdpConstructor(socket)
      )
    ).resolves.toBeUndefined()
    const expressions = socket.evaluations
      .map((evaluation) => evaluation.params.expression)
      .join('\n')
    expect(expressions).toContain('input[placeholder],textarea[placeholder]')
    expect(expressions).toContain('More session actions')
    expect(expressions).toContain('closest(\'button,[role="button"],a,[tabindex]\')')
    expect(expressions).toContain('getBoundingClientRect()')
    expect(expressions).toContain("scrollIntoView({ block: 'nearest', inline: 'nearest' })")
    expect(expressions).toContain('data-orca-cdp-activation')
    expect(expressions).toContain('__orcaCdpActivationLedger')
    expect(expressions).toContain("Object.getOwnPropertyDescriptor(prototype, 'value')")
    expect(expressions).toContain("new InputEvent('input'")
    expect(expressions).toContain('element.click()')
  })

  it('requires renderer-loss evidence after requesting a debug process crash', async () => {
    const socket = new FakeProcessTerminationSocket()
    await expect(
      terminateHostedWebViewProcess(
        { webSocketDebuggerUrl: 'ws://127.0.0.1/devtools/page/current' },
        fakeCdpConstructor(socket)
      )
    ).resolves.toBeUndefined()
    expect(socket.command).toEqual({ id: 1, method: 'Page.crash' })
  })

  it('observes an ordered reconnect while recording retained route evidence', async () => {
    const entries = [
      {
        state: 'recovering',
        href: 'orca-mobile-web://session-a/h/host/agent-history/worktree',
        retainedExpectedText: true,
        retainedExpectedRoute: true
      },
      {
        state: 'connected',
        href: 'orca-mobile-web://session-a/h/host/agent-history/worktree',
        retainedExpectedText: true,
        retainedExpectedRoute: true
      }
    ]
    const socket = new FakeCdpSocket([JSON.stringify({ started: true }), JSON.stringify(entries)])
    const document = {
      webSocketDebuggerUrl: 'ws://127.0.0.1/devtools/page/current'
    }
    const WebSocketCtor = fakeCdpConstructor(socket)

    await startHostedWebViewConnectionObservation(
      document,
      {
        expectedText: 'Hybrid Agent History Fixture',
        expectedHrefIncludes: '/agent-history/'
      },
      WebSocketCtor
    )
    await expect(
      waitForHostedWebViewConnectionSequence(
        document,
        ['recovering', 'connected'],
        1_000,
        WebSocketCtor
      )
    ).resolves.toEqual(entries)

    const expressions = socket.evaluations
      .map((evaluation) => evaluation.params.expression)
      .join('\n')
    expect(expressions).toContain("addEventListener('message'")
    expect(expressions).toContain("message?.type !== 'connection'")
    expect(expressions).toContain('requestAnimationFrame')
    expect(expressions).toContain('retainedExpectedText')
    expect(expressions).toContain('retainedExpectedRoute')
  })

  it('keeps the native probe DEBUG-only, loopback-only, and completion-marked', () => {
    const probeStart = iosShellSource.indexOf(
      'private func mobileWebNetworkIsolationProbeUserScript()'
    )
    const debugStart = iosShellSource.lastIndexOf('#if DEBUG', probeStart)
    const debugEnd = iosShellSource.indexOf('#endif', probeStart)
    const probeSource = iosShellSource.slice(debugStart, debugEnd)

    expect(debugStart).toBeGreaterThanOrEqual(0)
    expect(debugEnd).toBeGreaterThan(probeStart)
    expect(probeSource).toContain('ORCA_E2E_MOBILE_WEB_NETWORK_PROBE_PORT')
    expect(probeSource).toContain('ORCA_E2E_MOBILE_WEB_NETWORK_PROBE_TOKEN')
    expect(probeSource).toContain('http://127.0.0.1:')
    expect(probeSource).toContain('ws://127.0.0.1:')
    expect(probeSource).toContain('completed===4')
    expect(probeSource).toContain('__orcaDebugNavigationProbeCompletion')
    expect(probeSource).toContain("window.open(probeBase+'/popup-probe','_blank')")
    expect(probeSource).toContain("frame.src=probeBase+'/redirect-probe'")
    expect(probeSource).toContain("download.href=probeBase+'/download-probe'")
    expect(probeSource).toContain("navigator.serviceWorker.register(probeBase+'/worker-probe')")
    expect(probeSource).toContain("location.assign('orca-security-probe://blocked')")
    expect(probeSource).toContain('forMainFrameOnly: true')
    expect(iosShellSource).toContain(
      '#if DEBUG\n    if let networkProbe = mobileWebNetworkIsolationProbeUserScript()'
    )
  })

  it('keeps the Android probe debuggable-only and installs it at document start', () => {
    expect(androidProbeSource).toContain('BuildConfig.DEBUG')
    expect(androidProbeSource).toContain('ApplicationInfo.FLAG_DEBUGGABLE')
    expect(androidProbeSource).toContain('val debuggingEnabled = BuildConfig.DEBUG && isDebuggable')
    expect(androidProbeSource).toContain('WebView.setWebContentsDebuggingEnabled(debuggingEnabled)')
    expect(androidProbeSource).toContain('if (!debuggingEnabled) return')
    expect(androidProbeSource).toContain('ORCA_E2E_MOBILE_WEB_NETWORK_PROBE_PORT')
    expect(androidProbeSource).toContain('ORCA_E2E_MOBILE_WEB_NETWORK_PROBE_TOKEN')
    expect(androidProbeSource).toContain('http://127.0.0.1:')
    expect(androidProbeSource).toContain('ws://127.0.0.1:')
    expect(androidProbeSource).toContain('globalThis.__orcaRunSecurityProbe=function()')
    expect(androidProbeSource).toContain('globalThis.__orcaMobileWebShellListening!==true')
    expect(androidProbeSource).toContain('completed===4')
    expect(androidProbeSource).toContain('__orcaDebugNavigationProbeCompletion')
    expect(androidProbeSource).toContain("window.open(probeBase+'/popup-probe','_blank')")
    expect(androidProbeSource).toContain("frame.src=probeBase+'/redirect-probe'")
    expect(androidProbeSource).toContain("download.href=probeBase+'/download-probe'")
    expect(androidProbeSource).toContain(
      "navigator.serviceWorker.register(probeBase+'/worker-probe')"
    )
    expect(androidProbeSource).toContain("location.assign('orca-security-probe://blocked')")
    expect(androidProbeSource).toContain('WebViewFeature.DOCUMENT_START_SCRIPT')
    expect(androidProbeSource).toContain('WebViewCompat.addDocumentStartJavaScript')
    expect(androidProbeSource).toContain('setOf(MOBILE_WEB_ORIGIN)')
    expect(androidShellSource).toContain('installMobileWebDebugIsolationProbe(webView, appContext)')
    expect(expoLogBoxPatch).toContain(
      'context.applicationInfo.flags and ApplicationInfo.FLAG_DEBUGGABLE != 0'
    )
    expect(expoLogBoxPatch).toContain('-    setWebContentsDebuggingEnabled(true)')
    expect(expoLogBoxPatch).toContain('+    setWebContentsDebuggingEnabled(isDebuggable)')
    expect(expoDomWebViewPatch).toContain(
      '+    WebView.setWebContentsDebuggingEnabled(webviewDebuggingEnabled && isDebuggable)'
    )
    expect(reactNativeWebViewPatch).toContain(
      '+        RNCWebView.setWebContentsDebuggingEnabled(enabled && isDebuggable)'
    )
    expect(reactNativeWebViewPatch).toContain(
      '+        if (ReactBuildConfig.DEBUG && isDebuggable) {'
    )
  })

  it('requires a production Android image for the Release inspector gate', () => {
    expect(androidReleaseHarnessSource).toContain("buildType !== 'user'")
    expect(androidReleaseHarnessSource).toContain("debuggable !== '0'")
    expect(androidReleaseHarnessSource).toContain("!fingerprint.includes(':user/')")
    expect(androidReleaseHarnessSource).toContain("packageFlags.includes('DEBUGGABLE')")
    expect(androidReleaseHarnessSource).toContain("'am', 'force-stop'")
    expect(androidReleaseHarnessSource).toContain("'uiautomator', 'dump', '/dev/tty'")
    expect(androidReleaseHarnessSource).toContain('assertNoInspectorSocket(options, pid)')
    expect(androidReleaseHarnessSource).toContain(
      'Android Release DevTools discovery endpoint is accessible'
    )
  })

  it('builds and installs the exact native shell before the isolated live gate', () => {
    expect(simulatorHarnessSource).toContain('nativeAppPath = options.skipNativeBuild')
    expect(simulatorHarnessSource).toContain(
      "await evidenceStep('cached native simulator app install'"
    )
    expect(simulatorHarnessSource).toContain(": await evidenceStep('native simulator app build'")
    expect(simulatorHarnessSource).toContain('options.securityOnly')
    expect(simulatorHarnessSource).toContain(
      "expectedText: options.sourceControlOnly ? '1 tab' : '2 tabs'"
    )
    expect(simulatorHarnessSource).toContain(
      "await evidenceStep('hosted terminal device input journey'"
    )
    expect(simulatorHarnessSource).toContain("await evidenceStep('Photos permission reset'")
    expect(simulatorHarnessSource).toContain('await clearHostedIosWebViewSecurityProbe(deviceUdid)')
    expect(simulatorAppBuildSource).toContain("'xcodebuild'")
    expect(simulatorAppBuildSource).toContain("'simctl', 'install', deviceUdid, appPath")
    expect(simulatorAppBuildSource).not.toContain('CODE_SIGNING_ALLOWED=NO')
  })

  it('installs and launches the exact Android shell with a proven sentinel', () => {
    expect(androidSecurityHarnessSource).toContain("['install', '-r', '-t', options.apk]")
    expect(androidSecurityHarnessSource).toContain(
      "['reverse', `tcp:${probe.port}`, `tcp:${probe.port}`]"
    )
    expect(androidSecurityHarnessSource).toContain("'nc', '-z', '-w', '5', '127.0.0.1'")
    expect(androidSecurityHarnessSource).toContain("includes('tcp:connection')")
    expect(androidSecurityHarnessSource).toContain('probe.reset()')
    expect(androidSecurityHarnessSource).toContain("'ORCA_E2E_MOBILE_WEB_NETWORK_PROBE_PORT'")
    expect(androidSecurityHarnessSource).toContain("'ORCA_E2E_MOBILE_WEB_NETWORK_PROBE_TOKEN'")
    expect(androidSecurityHarnessSource).toContain('waitForVisibleHostedWebView')
    expect(androidSecurityHarnessSource).toContain('verifyHostedWebViewNetworkIsolation')
    expect(androidSecurityHarnessSource).toContain('verifyHostedWebViewNavigationIsolation')
    expect(androidSecurityHarnessSource).toContain('probe.observations.length > 0')
  })

  it('crashes three Android renderers and requires native activation rollback', () => {
    expect(androidCrashLoopHarnessSource).toContain('const failureCount = 3')
    expect(androidCrashLoopHarnessSource).toContain('terminateHostedWebViewProcess(document)')
    expect(androidCrashLoopHarnessSource).toContain('initial.previous')
    expect(androidCrashLoopHarnessSource).toContain('waitForAndroidActivation(')
    expect(androidCrashLoopHarnessSource).toContain('>= 60_000')
    expect(androidCrashLoopHarnessSource).toContain('documents.at(-1)?.href === documents[0]?.href')
  })
})

class FakeCdpSocket {
  evaluations: {
    id: number
    params: { expression: string; returnByValue: boolean }
  }[] = []
  private readonly values: string[]
  private messageListener: ((data: Buffer) => void) | undefined

  constructor(values: string[]) {
    this.values = [...values]
  }

  once(event: string, listener: (value?: unknown) => void): void {
    if (event === 'open') {
      queueMicrotask(listener)
    }
  }

  on(event: string, listener: (data: Buffer) => void): void {
    if (event === 'message') {
      this.messageListener = listener
    }
  }

  send(payload: string): void {
    this.evaluations.push(JSON.parse(payload))
    const value = this.values.shift() ?? ''
    queueMicrotask(() => {
      this.messageListener?.(Buffer.from(JSON.stringify({ id: 1, result: { result: { value } } })))
    })
  }

  close(): void {}
}

class FakeProcessTerminationSocket {
  command: unknown
  private messageListener: ((data: Buffer) => void) | undefined

  once(event: string, listener: (value?: unknown) => void): void {
    if (event === 'open') {
      queueMicrotask(listener)
    }
  }

  on(event: string, listener: (data: Buffer) => void): void {
    if (event === 'message') {
      this.messageListener = listener
    }
  }

  send(payload: string): void {
    this.command = JSON.parse(payload)
    queueMicrotask(() => {
      this.messageListener?.(
        Buffer.from(
          JSON.stringify({
            method: 'Inspector.detached',
            params: { reason: 'Render process gone.' }
          })
        )
      )
    })
  }

  close(): void {}
}

function fakeCdpConstructor(socket: FakeCdpSocket | FakeProcessTerminationSocket) {
  return class {
    constructor() {
      return socket
    }
  }
}
