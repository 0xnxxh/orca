import ExpoModulesCore
import WebKit

private let mobileWebScheme = "orca-mobile-web"
private let mobileWebBridgeHandler = "orcaBridge"
private let mobileWebMessageByteLimit = 640 * 1024
private let mobileWebPendingMessageLimit = 32
private let mobileWebCsp = [
  "default-src 'none'",
  "script-src 'self' 'sha256-1U6xDmOrcY3IC5LxY6dRlxDPeS9l4iILlzMspyz5qlY='",
  // Why: React Native Web emits runtime style elements and attributes for the existing mobile UI.
  "style-src 'self' 'unsafe-inline'",
  "font-src 'self'",
  "img-src 'self' data: blob:",
  "connect-src 'none'",
  "media-src 'none'",
  "object-src 'none'",
  "frame-src data:",
  "child-src data:",
  "worker-src 'none'",
  "base-uri 'none'",
  "form-action 'none'",
  "frame-ancestors 'none'"
].joined(separator: "; ")
private let mobileWebNetworkRules = """
  [
    {
      "trigger": { "url-filter": "^https?://.*" },
      "action": { "type": "block" }
    },
    {
      "trigger": { "url-filter": "^wss?://.*" },
      "action": { "type": "block" }
    }
  ]
  """

private func installMobileWebNetworkBlocker(
  into controller: WKUserContentController,
  completion: @escaping (Bool) -> Void
) {
  WKContentRuleListStore.default().compileContentRuleList(
    forIdentifier: "orca.mobile-web.network-block-v1",
    encodedContentRuleList: mobileWebNetworkRules
  ) { ruleList, _ in
    DispatchQueue.main.async {
      guard let ruleList else {
        completion(false)
        return
      }
      controller.add(ruleList)
      completion(true)
    }
  }
}
private let mobileWebNetworkApiBlocker = """
  (function(){
  Object.defineProperties(globalThis,{
    fetch:{
      value:function(){return Promise.reject(new TypeError('Network access is disabled'))},
      configurable:false,
      writable:false
    },
    XMLHttpRequest:{
      value:function(){throw new TypeError('Network access is disabled')},
      configurable:false,
      writable:false
    },
    WebSocket:{
      value:function(){throw new TypeError('Network access is disabled')},
      configurable:false,
      writable:false
    }
  });
  try {
    var nativeNavigator=globalThis.navigator;
    var restrictedNavigator=new Proxy(nativeNavigator,{
      get:function(target,property){
        if(property==='serviceWorker') return undefined;
        return Reflect.get(target,property,target);
      }
    });
    Object.defineProperty(globalThis,'navigator',{
      value:restrictedNavigator,
      configurable:false,
      writable:false
    });
  } catch (_) {}
  try {
    var serviceWorkerContainer=nativeNavigator.serviceWorker;
    var serviceWorkerPrototype=Object.getPrototypeOf(serviceWorkerContainer);
    Object.defineProperty(serviceWorkerPrototype,'register',{
      value:function(){return Promise.reject(new TypeError('Network access is disabled'))},
      configurable:false,
      writable:false
    });
  } catch (_) {}
  try {
    Object.defineProperty(navigator,'serviceWorker',{
      value:undefined,
      configurable:false,
      writable:false
    });
  } catch (_) {}
  try {
    Object.defineProperty(Navigator.prototype,'serviceWorker',{
      get:function(){return undefined},
      configurable:false
    });
  } catch (_) {}
  addEventListener('click',function(event){
    var target=event.target;
    var anchor=target instanceof Element?target.closest('a[href]'):null;
    if(!anchor) return;
    if(anchor.hasAttribute('download')||/^(?:https?|wss?):$/.test(anchor.protocol)){
      event.preventDefault();
    }
  },true);
  })();
  """

#if DEBUG
private func mobileWebNetworkIsolationProbeUserScript() -> WKUserScript? {
  let environment = ProcessInfo.processInfo.environment
  guard
    let portValue = environment["ORCA_E2E_MOBILE_WEB_NETWORK_PROBE_PORT"],
    let port = UInt16(portValue),
    port > 0,
    let tokenValue = environment["ORCA_E2E_MOBILE_WEB_NETWORK_PROBE_TOKEN"],
    let token = UUID(uuidString: tokenValue)?.uuidString
  else { return nil }
  let source = """
    globalThis.__orcaRunSecurityProbe=function(){
      if(globalThis.__orcaDebugSecurityProbeStarted==='\(token)') return;
      globalThis.__orcaDebugSecurityProbeStarted='\(token)';
      var probeBase='http://127.0.0.1:\(port)';
      var originalLocation=String(location.href);
      var popupBlocked=false;
      var serviceWorkerBlocked=typeof navigator.serviceWorker==='undefined';
      var completed=0;
      var complete=function(){
        completed+=1;
        if(completed===4) globalThis.__orcaDebugNetworkProbeCompletion='\(token)';
      };
      try {
        fetch('http://127.0.0.1:\(port)/network-probe').catch(function(){});
      } catch (_) {} finally { complete(); }
      try {
        var request=new XMLHttpRequest();
        request.open('GET','http://127.0.0.1:\(port)/network-probe');
        request.send();
      } catch (_) {} finally { complete(); }
      try {
        var socket=new WebSocket('ws://127.0.0.1:\(port)/socket-probe');
        socket.onerror=function(){};
      } catch (_) {} finally { complete(); }
      try {
        var image=new Image();
        image.onerror=function(){};
        image.src=probeBase+'/network-probe';
        document.documentElement.appendChild(image);
      } catch (_) {} finally { complete(); }
      try {
        popupBlocked=window.open(probeBase+'/popup-probe','_blank')===null;
      } catch (_) { popupBlocked=true; }
      try {
        var frame=document.createElement('iframe');
        frame.hidden=true;
        frame.src=probeBase+'/redirect-probe';
        document.documentElement.appendChild(frame);
      } catch (_) {}
      try {
        var download=document.createElement('a');
        download.hidden=true;
        download.download='orca-security-probe.txt';
        download.href=probeBase+'/download-probe';
        document.documentElement.appendChild(download);
        download.click();
      } catch (_) {}
      try {
        if(!serviceWorkerBlocked){
          navigator.serviceWorker.register(probeBase+'/worker-probe').then(
            function(){serviceWorkerBlocked=false;},
            function(){serviceWorkerBlocked=true;}
          );
        }
      } catch (_) { serviceWorkerBlocked=true; }
      try { location.assign('orca-security-probe://blocked'); } catch (_) {}
      setTimeout(function(){
        globalThis.__orcaDebugNavigationProbeCompletion=JSON.stringify({
          token:'\(token)',
          documentRetained:String(location.href)===originalLocation,
          popupBlocked:popupBlocked,
          serviceWorkerBlocked:serviceWorkerBlocked,
          redirectFrameAttempted:true,
          downloadAttempted:true,
          externalSchemeAttempted:true
        });
        frame?.remove();
        download?.remove();
      },250);
    };
    """
  return WKUserScript(source: source, injectionTime: .atDocumentStart, forMainFrameOnly: true)
}
#endif

private final class WeakScriptMessageHandler: NSObject, WKScriptMessageHandler {
  weak var target: WKScriptMessageHandler?

  func userContentController(
    _ userContentController: WKUserContentController,
    didReceive message: WKScriptMessage
  ) {
    target?.userContentController(userContentController, didReceive: message)
  }
}

private final class MobileWebSchemeHandler: NSObject, WKURLSchemeHandler {
  func webView(_ webView: WKWebView, start urlSchemeTask: WKURLSchemeTask) {
    do {
      let request = urlSchemeTask.request
      guard
        request.httpMethod == nil || request.httpMethod == "GET",
        request.value(forHTTPHeaderField: "Range") == nil,
        let url = request.url,
        let components = URLComponents(url: url, resolvingAgainstBaseURL: false),
        url.scheme == mobileWebScheme,
        let sessionId = url.host,
        url.query == nil,
        url.fragment == nil,
        !components.percentEncodedPath.contains("%")
      else {
        throw URLError(.unsupportedURL)
      }
      let requestPath = String(url.path.drop(while: { $0 == "/" }))
      // Why: Expo Router must see "/" while the package store retains a concrete document asset.
      let path = requestPath.isEmpty ? "index.html" : requestPath
      let asset = try sharedMobileWebPackageStore.readAsset(sessionId: sessionId, path: path)
      var headers = [
        "Content-Type": asset.contentType,
        "Content-Length": String(asset.data.count),
        "Cache-Control": "no-store",
        "X-Content-Type-Options": "nosniff"
      ]
      if asset.isDocument {
        headers["Content-Security-Policy"] = mobileWebCsp
      }
      guard let response = HTTPURLResponse(
        url: url,
        statusCode: 200,
        httpVersion: "HTTP/1.1",
        headerFields: headers
      ) else {
        throw URLError(.cannotParseResponse)
      }
      urlSchemeTask.didReceive(response)
      urlSchemeTask.didReceive(asset.data)
      urlSchemeTask.didFinish()
    } catch {
      urlSchemeTask.didFailWithError(URLError(.resourceUnavailable))
    }
  }

  func webView(_ webView: WKWebView, stop urlSchemeTask: WKURLSchemeTask) {}
}

final class MobileWebShellView: ExpoView, WKNavigationDelegate, WKUIDelegate,
  WKScriptMessageHandler {
  let onBridgeMessage = EventDispatcher()
  let onNavigationBlocked = EventDispatcher()
  let onProcessTerminated = EventDispatcher()
  let onLoadState = EventDispatcher()

  private let messageHandler = WeakScriptMessageHandler()
  private let schemeHandler = MobileWebSchemeHandler()
  private var webView: WKWebView!
  private var webViewConstraints: [NSLayoutConstraint] = []
  private var activeSessionId: String?
  private var networkBlockReady = false
  private var networkBlockFailed = false

  required init(appContext: AppContext? = nil) {
    super.init(appContext: appContext)
    let configuration = WKWebViewConfiguration()
    configuration.websiteDataStore = .nonPersistent()
    configuration.defaultWebpagePreferences.allowsContentJavaScript = true
    configuration.preferences.javaScriptCanOpenWindowsAutomatically = false
    if #available(iOS 14.0, *) {
      configuration.limitsNavigationsToAppBoundDomains = true
    }
    configuration.setURLSchemeHandler(schemeHandler, forURLScheme: mobileWebScheme)
    messageHandler.target = self
    configuration.userContentController.add(messageHandler, name: mobileWebBridgeHandler)
    configuration.userContentController.addUserScript(
      WKUserScript(
        source: "window.OrcaNative=Object.freeze({postMessage:function(value){window.webkit.messageHandlers.orcaBridge.postMessage(value)}});",
        injectionTime: .atDocumentStart,
        forMainFrameOnly: true
      )
    )
    configuration.userContentController.addUserScript(
      WKUserScript(
        source: mobileWebNetworkApiBlocker,
        injectionTime: .atDocumentStart,
        forMainFrameOnly: false
      )
    )
    #if DEBUG
    if let networkProbe = mobileWebNetworkIsolationProbeUserScript() {
      configuration.userContentController.addUserScript(networkProbe)
    }
    #endif
    webView = WKWebView(frame: bounds, configuration: configuration)
    #if DEBUG
    if #available(iOS 16.4, *) {
      webView.isInspectable = true
    }
    #endif
    webView.translatesAutoresizingMaskIntoConstraints = false
    webView.navigationDelegate = self
    webView.uiDelegate = self
    webView.allowsBackForwardNavigationGestures = false
    webView.scrollView.contentInsetAdjustmentBehavior = .never
    attachWebView()
    installMobileWebNetworkBlocker(into: configuration.userContentController) { [weak self] ready in
      self?.finishNetworkBlockerInstallation(ready)
    }
  }

  private func attachWebView() {
    guard webView.superview == nil else { return }
    addSubview(webView)
    webViewConstraints = [
      webView.topAnchor.constraint(equalTo: topAnchor),
      webView.bottomAnchor.constraint(equalTo: bottomAnchor),
      webView.leadingAnchor.constraint(equalTo: leadingAnchor),
      webView.trailingAnchor.constraint(equalTo: trailingAnchor)
    ]
    NSLayoutConstraint.activate(webViewConstraints)
  }

  private func detachWebView() {
    NSLayoutConstraint.deactivate(webViewConstraints)
    webViewConstraints.removeAll()
    webView.removeFromSuperview()
  }

  deinit {
    webView?.configuration.userContentController.removeScriptMessageHandler(
      forName: mobileWebBridgeHandler
    )
  }

  func setSessionId(_ sessionId: String?) {
    guard let sessionId else {
      deactivateSessionView()
      return
    }
    guard sessionId != activeSessionId else { return }
    activeSessionId = sessionId
    webView.stopLoading()
    attachWebView()
    isHidden = false
    webView.isHidden = false
    onLoadState(["state": "loading"])
    if networkBlockFailed {
      onLoadState(["state": "failed"])
      return
    }
    loadActiveSessionIfReady()
  }

  func activateSessionView(_ sessionId: String) {
    setSessionId(sessionId)
  }

  func deactivateSessionView() {
    activeSessionId = nil
    webView.stopLoading()
    isHidden = true
    webView.isHidden = true
    webView.loadHTMLString("", baseURL: nil)
    detachWebView()
  }

  func postMessage(_ message: String) async throws {
    guard message.utf8.count <= mobileWebMessageByteLimit else {
      throw MobileWebViewError("mobile_web_bridge_message_too_large")
    }
    let encoded = try String(
      data: JSONEncoder().encode(message),
      encoding: .utf8
    ).orThrow(MobileWebViewError("mobile_web_bridge_message_invalid"))
    try await webView.evaluateJavaScript(
      """
      (function(value){
        if(window.__orcaMobileWebShellListening===true){
          window.dispatchEvent(new MessageEvent('message',{data:value}));
          return;
        }
        var pending=window.__orcaMobileWebShellPending;
        if(!Array.isArray(pending)) pending=window.__orcaMobileWebShellPending=[];
        if(pending.length<\(mobileWebPendingMessageLimit)) pending.push(value);
      })(\(encoded))
      """
    )
  }

  func userContentController(
    _ userContentController: WKUserContentController,
    didReceive message: WKScriptMessage
  ) {
    guard
      message.name == mobileWebBridgeHandler,
      message.frameInfo.isMainFrame,
      let source = message.frameInfo.request.url,
      source.scheme == mobileWebScheme,
      source.host == activeSessionId,
      let body = message.body as? String,
      body.utf8.count <= mobileWebMessageByteLimit
    else { return }
    onBridgeMessage(["data": body])
  }

  func webView(
    _ webView: WKWebView,
    decidePolicyFor navigationAction: WKNavigationAction,
    decisionHandler: @escaping (WKNavigationActionPolicy) -> Void
  ) {
    if #available(iOS 14.5, *), navigationAction.shouldPerformDownload {
      if let url = navigationAction.request.url {
        onNavigationBlocked(["url": String(url.absoluteString.prefix(2_048))])
      }
      decisionHandler(.cancel)
      return
    }
    if navigationAction.targetFrame?.isMainFrame == false {
      let allowed = navigationAction.request.url?.scheme == "data"
      if !allowed, let url = navigationAction.request.url {
        onNavigationBlocked(["url": String(url.absoluteString.prefix(2_048))])
      }
      decisionHandler(allowed ? .allow : .cancel)
      return
    }
    guard
      navigationAction.targetFrame?.isMainFrame == true,
      isAllowedDocumentUrl(navigationAction.request.url)
    else {
      if let url = navigationAction.request.url {
        onNavigationBlocked(["url": String(url.absoluteString.prefix(2_048))])
      }
      decisionHandler(.cancel)
      return
    }
    decisionHandler(.allow)
  }

  func webView(
    _ webView: WKWebView,
    decidePolicyFor navigationResponse: WKNavigationResponse,
    decisionHandler: @escaping (WKNavigationResponsePolicy) -> Void
  ) {
    let url = navigationResponse.response.url
    let allowed: Bool
    if navigationResponse.isForMainFrame {
      allowed = isAllowedDocumentUrl(url) && navigationResponse.canShowMIMEType
    } else {
      allowed = url?.scheme == "data" && navigationResponse.canShowMIMEType
    }
    if !allowed, let url {
      onNavigationBlocked(["url": String(url.absoluteString.prefix(2_048))])
    }
    decisionHandler(allowed ? .allow : .cancel)
  }

  func webView(_ webView: WKWebView, didFinish navigation: WKNavigation!) {
    onLoadState(["state": "loaded"])
  }

  func webView(
    _ webView: WKWebView,
    didFail navigation: WKNavigation!,
    withError error: Error
  ) {
    onLoadState(["state": "failed"])
  }

  func webViewWebContentProcessDidTerminate(_ webView: WKWebView) {
    onProcessTerminated(["sessionId": activeSessionId ?? ""])
  }

  func webView(
    _ webView: WKWebView,
    createWebViewWith configuration: WKWebViewConfiguration,
    for navigationAction: WKNavigationAction,
    windowFeatures: WKWindowFeatures
  ) -> WKWebView? {
    if let url = navigationAction.request.url {
      onNavigationBlocked(["url": String(url.absoluteString.prefix(2_048))])
    }
    return nil
  }

  private func isAllowedDocumentUrl(_ url: URL?) -> Bool {
    guard
      let url,
      let components = URLComponents(url: url, resolvingAgainstBaseURL: false)
    else { return false }
    return url.scheme == mobileWebScheme
      && url.host == activeSessionId
      && url.path == "/"
      && url.query == nil
      && url.fragment == nil
      && !components.percentEncodedPath.contains("%")
  }

  private func finishNetworkBlockerInstallation(_ ready: Bool) {
    networkBlockReady = ready
    networkBlockFailed = !ready
    if ready {
      loadActiveSessionIfReady()
    } else if activeSessionId != nil {
      onLoadState(["state": "failed"])
    }
  }

  private func loadActiveSessionIfReady() {
    guard
      networkBlockReady,
      let sessionId = activeSessionId,
      let url = URL(string: "\(mobileWebScheme)://\(sessionId)/")
    else { return }
    webView.load(URLRequest(url: url, cachePolicy: .reloadIgnoringLocalCacheData))
  }
}

private struct MobileWebViewError: Error {
  let code: String

  init(_ code: String) {
    self.code = code
  }
}

private extension Optional {
  func orThrow(_ error: @autoclosure () -> Error) throws -> Wrapped {
    guard let value = self else { throw error() }
    return value
  }
}
