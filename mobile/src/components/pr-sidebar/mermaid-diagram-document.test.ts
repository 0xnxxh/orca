import { createHash } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { gunzipSync } from 'node:zlib'
import { describe, expect, it } from 'vitest'
import {
  buildMermaidDiagramDocument,
  MERMAID_DIAGRAM_SCRIPT,
  MERMAID_DIAGRAM_SCRIPT_CSP_HASH
} from './mermaid-diagram-document'
import { parseMermaidDiagramMessage } from './mermaid-diagram-contract'
import {
  MERMAID_WEBVIEW_ENGINE_GZIP_BASE64,
  MERMAID_WEBVIEW_ENGINE_CSP_HASH
} from './mermaid-webview-engine.generated'

function scriptHash(script: string): string {
  return `'sha256-${createHash('sha256').update(script).digest('base64')}'`
}

describe('Mermaid diagram document', () => {
  it('hash-authorizes only the bundled engine and fixed sanitizer runner', () => {
    const payload = '</textarea><script src="https://sentinel.invalid/pwn.js"></script>'
    const document = buildMermaidDiagramDocument(payload, 'frame-token')
    const engine = gunzipSync(Buffer.from(MERMAID_WEBVIEW_ENGINE_GZIP_BASE64, 'base64')).toString()

    expect(MERMAID_WEBVIEW_ENGINE_CSP_HASH).toBe(scriptHash(engine))
    expect(MERMAID_DIAGRAM_SCRIPT_CSP_HASH).toBe(scriptHash(MERMAID_DIAGRAM_SCRIPT))
    expect(document).toContain(
      `script-src ${MERMAID_WEBVIEW_ENGINE_CSP_HASH} ${MERMAID_DIAGRAM_SCRIPT_CSP_HASH}`
    )
    expect(document).toContain("default-src 'none'")
    expect(document).toContain("connect-src 'none'")
    expect(document).toContain("worker-src 'none'")
    expect(document).not.toContain(payload)
    expect(document).not.toContain('frame-token')
    expect(document).not.toContain('<script src=')
    expect(document.match(/<script>/g)).toHaveLength(1)
  })

  it('sanitizes generated SVG and disables Mermaid HTML labels and links', () => {
    expect(MERMAID_DIAGRAM_SCRIPT).toContain("securityLevel: 'strict'")
    expect(MERMAID_DIAGRAM_SCRIPT).toContain('htmlLabels: false')
    expect(MERMAID_DIAGRAM_SCRIPT).toContain("FORBID_TAGS: ['a', 'foreignObject', 'script']")
    expect(MERMAID_DIAGRAM_SCRIPT).toContain('container.innerHTML = clean')
  })

  it('keeps the hosted document below WebKit inline-document limits', () => {
    const document = buildMermaidDiagramDocument('graph TD; A-->B', 'frame-token', '')

    expect(Buffer.byteLength(document)).toBeLessThan(16 * 1024)
    expect(document).not.toContain(MERMAID_WEBVIEW_ENGINE_GZIP_BASE64)
    expect(MERMAID_DIAGRAM_SCRIPT).toContain('event.source !== parent')
    expect(MERMAID_DIAGRAM_SCRIPT).toContain(
      `message.engine.length !== ${MERMAID_WEBVIEW_ENGINE_GZIP_BASE64.length}`
    )
  })

  it('accepts only bounded typed renderer messages', () => {
    expect(
      parseMermaidDiagramMessage({
        channel: 'orca-mobile-mermaid',
        type: 'rendered',
        token: '',
        height: 120.2
      })
    ).toEqual({ type: 'rendered', height: 121 })
    expect(
      parseMermaidDiagramMessage({ channel: 'orca-mobile-mermaid', type: 'error', token: '' })
    ).toEqual({ type: 'error' })
    expect(
      parseMermaidDiagramMessage({ channel: 'orca-mobile-mermaid', type: 'ready', token: '' })
    ).toEqual({ type: 'ready' })
    expect(
      parseMermaidDiagramMessage({
        channel: 'orca-mobile-mermaid',
        type: 'rendered',
        token: '',
        height: 10001
      })
    ).toBeNull()
    expect(
      parseMermaidDiagramMessage({ channel: 'orca-mobile-mermaid', type: 'error', token: 'bad' })
    ).toBeNull()
    expect(parseMermaidDiagramMessage({ channel: 'other', type: 'error', token: '' })).toBeNull()
    expect(parseMermaidDiagramMessage('{')).toBeNull()
  })
})

describe('Mermaid diagram platform sources', () => {
  const nativeSource = readFileSync(new URL('./MermaidDiagram.tsx', import.meta.url), 'utf8')
  const webSource = readFileSync(new URL('./MermaidDiagram.web.tsx', import.meta.url), 'utf8')
  const presentationSource = readFileSync(
    new URL('./mermaid-diagram-presentation.tsx', import.meta.url),
    'utf8'
  )

  it('shares the existing diagram/fallback presentation', () => {
    expect(nativeSource).toContain('<MermaidDiagramPresentation')
    expect(webSource).toContain('<MermaidDiagramPresentation')
    expect(presentationSource).toContain('<Text style={styles.labelText}>mermaid</Text>')
  })

  it('locks the native WebView to the bundled network-denied document', () => {
    expect(nativeSource).toContain("originWhitelist={['about:blank']}")
    expect(nativeSource).toContain('allowFileAccess={false}')
    expect(nativeSource).toContain('allowUniversalAccessFromFileURLs={false}')
    expect(nativeSource).not.toContain("originWhitelist={['*']}")
    expect(nativeSource).not.toContain('cdn.jsdelivr.net')
  })

  it('uses a token-bound, no-same-origin document frame for RNW', () => {
    expect(webSource).toContain('srcDoc={document}')
    expect(webSource).toContain('sandbox="allow-scripts"')
    expect(webSource).not.toContain('allow-same-origin')
    expect(webSource).toContain('event.source !== frame.contentWindow')
    expect(webSource).toContain('parseMermaidDiagramMessage(event.data, frameToken)')
    expect(webSource).toContain('MERMAID_DIAGRAM_ENGINE_MESSAGE_CHANNEL')
  })
})
