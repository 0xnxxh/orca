package expo.modules.mobilewebshell

import android.content.pm.ApplicationInfo
import android.webkit.WebView
import androidx.webkit.WebViewCompat
import androidx.webkit.WebViewFeature
import expo.modules.kotlin.AppContext
import java.util.UUID

private const val NETWORK_PROBE_PORT_EXTRA = "ORCA_E2E_MOBILE_WEB_NETWORK_PROBE_PORT"
private const val NETWORK_PROBE_TOKEN_EXTRA = "ORCA_E2E_MOBILE_WEB_NETWORK_PROBE_TOKEN"

internal fun installMobileWebDebugIsolationProbe(
  webView: WebView,
  appContext: AppContext
) {
  val isDebuggable =
    webView.context.applicationInfo.flags and ApplicationInfo.FLAG_DEBUGGABLE != 0
  val debuggingEnabled = BuildConfig.DEBUG && isDebuggable
  WebView.setWebContentsDebuggingEnabled(debuggingEnabled)
  if (!debuggingEnabled) return
  val intent = appContext.currentActivity?.intent ?: return
  val script = createMobileWebDebugIsolationProbeScript(
    intent.getStringExtra(NETWORK_PROBE_PORT_EXTRA),
    intent.getStringExtra(NETWORK_PROBE_TOKEN_EXTRA)
  ) ?: return
  require(WebViewFeature.isFeatureSupported(WebViewFeature.DOCUMENT_START_SCRIPT)) {
    "mobile_web_debug_isolation_probe_unavailable"
  }
  WebViewCompat.addDocumentStartJavaScript(
    webView,
    script,
    setOf(MOBILE_WEB_ORIGIN)
  )
}

internal fun createMobileWebDebugIsolationProbeScript(
  portValue: String?,
  tokenValue: String?
): String? {
  val port = portValue?.toIntOrNull()?.takeIf { it in 1..65_535 } ?: return null
  val token = tokenValue?.takeIf(::isUuid) ?: return null
  val quotedToken = "\"$token\""
  return """
    (function(){
      globalThis.__orcaRunSecurityProbe=function(){
        if(globalThis.__orcaDebugSecurityProbeStarted===$quotedToken) return;
        if(globalThis.__orcaMobileWebShellListening!==true) return;
        globalThis.__orcaDebugSecurityProbeStarted=$quotedToken;
      var probeBase='http://127.0.0.1:$port';
      var originalOrigin=String(location.origin);
      var originalSession=String(location.hash);
      var popupBlocked=false;
      var serviceWorkerBlocked=typeof navigator.serviceWorker==='undefined';
      var completed=0;
      var frame=null;
      var download=null;
      var complete=function(){
        completed+=1;
        if(completed===4) globalThis.__orcaDebugNetworkProbeCompletion=$quotedToken;
      };
      try {
        fetch(probeBase+'/network-probe').catch(function(){});
      } catch (_) {} finally { complete(); }
      try {
        var request=new XMLHttpRequest();
        request.open('GET',probeBase+'/network-probe');
        request.send();
      } catch (_) {} finally { complete(); }
      try {
        var socket=new WebSocket('ws://127.0.0.1:$port/socket-probe');
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
        frame=document.createElement('iframe');
        frame.hidden=true;
        frame.src=probeBase+'/redirect-probe';
        document.documentElement.appendChild(frame);
      } catch (_) {}
      try {
        download=document.createElement('a');
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
          token:$quotedToken,
          documentRetained:String(location.origin)===originalOrigin&&
            String(location.hash)===originalSession,
          popupBlocked:popupBlocked,
          serviceWorkerBlocked:serviceWorkerBlocked,
          redirectFrameAttempted:true,
          downloadAttempted:true,
          externalSchemeAttempted:true
        });
        if(frame) frame.remove();
        if(download) download.remove();
      },250);
      };
    })();
  """.trimIndent()
}

private fun isUuid(value: String): Boolean {
  val parsed = runCatching { UUID.fromString(value) }.getOrNull() ?: return false
  return parsed.toString().equals(value, ignoreCase = true)
}
