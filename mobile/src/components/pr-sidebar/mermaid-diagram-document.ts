import { Buffer } from 'buffer/'
import {
  MERMAID_WEBVIEW_ENGINE_GZIP_BASE64,
  MERMAID_WEBVIEW_ENGINE_CSP_HASH
} from './mermaid-webview-engine.generated'
import { MERMAID_DIAGRAM_ENGINE_MESSAGE_CHANNEL } from './mermaid-diagram-contract'
import { colors } from '../../theme/mobile-theme'

export const MERMAID_DIAGRAM_SCRIPT_CSP_HASH =
  "'sha256-v9K6K6yhpGgwnPwRHUrzwsIfgzPoG60OYA3eW3UHSGE='"

export const MERMAID_DIAGRAM_SCRIPT = String.raw`(function () {
  function post(type, height) {
    var token = atob(document.getElementById('token').value);
    var message = { channel: 'orca-mobile-mermaid', type: type, token: token };
    if (height) message.height = height;
    var serialized = JSON.stringify(message);
    if (window.ReactNativeWebView) window.ReactNativeWebView.postMessage(serialized);
    else if (window.parent !== window) window.parent.postMessage(serialized, '*');
  }

  function decodeSource() {
    var binary = atob(document.getElementById('source').value);
    var bytes = new Uint8Array(binary.length);
    for (var index = 0; index < binary.length; index += 1) bytes[index] = binary.charCodeAt(index);
    return new TextDecoder('utf-8', { fatal: false }).decode(bytes);
  }

  async function loadEngine(encodedEngine) {
    if (typeof DecompressionStream === 'undefined') throw new Error('gzip unavailable');
    var binary = atob(encodedEngine);
    var bytes = new Uint8Array(binary.length);
    for (var index = 0; index < binary.length; index += 1) bytes[index] = binary.charCodeAt(index);
    var stream = new Blob([bytes]).stream().pipeThrough(new DecompressionStream('gzip'));
    var engine = await new Response(stream).text();
    var script = document.createElement('script');
    script.textContent = engine;
    document.head.appendChild(script);
  }

  async function render(encodedEngine) {
    await loadEngine(encodedEngine);
    var source = decodeSource();
    if (source.length > 131072) throw new Error('diagram source too large');
    var api = window.OrcaMermaid;
    var theme = getComputedStyle(document.documentElement);
    api.mermaid.initialize({
      startOnLoad: false,
      theme: 'dark',
      securityLevel: 'strict',
      darkMode: true,
      htmlLabels: false,
      themeVariables: {
        background: theme.getPropertyValue('--diagram-background'),
        primaryColor: theme.getPropertyValue('--diagram-primary'),
        primaryTextColor: theme.getPropertyValue('--diagram-text'),
        lineColor: theme.getPropertyValue('--diagram-line'),
        textColor: theme.getPropertyValue('--diagram-text')
      }
    });
    var result = await api.mermaid.render('orca-mermaid-diagram', source);
    var clean = api.sanitize(result.svg, {
      USE_PROFILES: { svg: true },
      FORBID_TAGS: ['a', 'foreignObject', 'script']
    });
    var container = document.getElementById('c');
    container.innerHTML = clean;
    var height = Math.ceil(container.scrollHeight);
    post('rendered', height > 0 && height <= 10000 ? height : 120);
  }

  function run(encodedEngine) {
    render(encodedEngine).catch(function () {
      post('error');
    });
  }

  var embeddedEngine = document.getElementById('engine').value;
  if (embeddedEngine) {
    run(embeddedEngine);
    return;
  }
  function receiveEngine(event) {
    var message = event.data;
    if (
      event.source !== parent ||
      !message ||
      message.channel !== '${MERMAID_DIAGRAM_ENGINE_MESSAGE_CHANNEL}' ||
      message.token !== atob(document.getElementById('token').value) ||
      typeof message.engine !== 'string' ||
      message.engine.length !== ${MERMAID_WEBVIEW_ENGINE_GZIP_BASE64.length}
    ) return;
    removeEventListener('message', receiveEngine);
    run(message.engine);
  }
  addEventListener('message', receiveEngine);
  post('ready');
})();`

const MERMAID_DIAGRAM_CSP = [
  "default-src 'none'",
  `script-src ${MERMAID_WEBVIEW_ENGINE_CSP_HASH} ${MERMAID_DIAGRAM_SCRIPT_CSP_HASH}`,
  "style-src 'unsafe-inline'",
  'img-src data:',
  "font-src 'none'",
  "connect-src 'none'",
  "media-src 'none'",
  "object-src 'none'",
  "frame-src 'none'",
  "child-src 'none'",
  "worker-src 'none'",
  "base-uri 'none'",
  "form-action 'none'",
  "frame-ancestors 'none'"
].join('; ')

export function buildMermaidDiagramDocument(
  source: string,
  token = '',
  embeddedEngine = MERMAID_WEBVIEW_ENGINE_GZIP_BASE64
): string {
  const encoded = Buffer.from(source, 'utf8').toString('base64')
  const encodedToken = Buffer.from(token, 'utf8').toString('base64')
  return `<!doctype html>
<html>
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1, maximum-scale=1, user-scalable=no" />
  <meta http-equiv="Content-Security-Policy" content="${MERMAID_DIAGRAM_CSP}" />
  <style>:root{--diagram-background:${colors.bgRaised};--diagram-primary:${colors.bgPanel};--diagram-text:${colors.textPrimary};--diagram-line:${colors.textSecondary}}html,body{box-sizing:border-box;margin:0;background:var(--diagram-background)}#c{padding:8px}#c svg{max-width:100%;height:auto}</style>
</head>
<body>
  <textarea id="engine" hidden>${embeddedEngine}</textarea>
  <textarea id="source" hidden>${encoded}</textarea>
  <textarea id="token" hidden>${encodedToken}</textarea>
  <div id="c"></div>
  <script>${MERMAID_DIAGRAM_SCRIPT}</script>
</body>
</html>`
}
