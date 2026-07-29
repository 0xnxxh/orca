import { useEffect, useMemo, useRef, useState } from 'react'
import { colors } from '../../theme/mobile-theme'
import {
  MERMAID_DIAGRAM_ENGINE_MESSAGE_CHANNEL,
  MERMAID_DIAGRAM_MAX_SOURCE_CHARACTERS,
  parseMermaidDiagramMessage
} from './mermaid-diagram-contract'
import { buildMermaidDiagramDocument } from './mermaid-diagram-document'
import { MermaidDiagramPresentation } from './mermaid-diagram-presentation'
import { MERMAID_WEBVIEW_ENGINE_GZIP_BASE64 } from './mermaid-webview-engine.generated'

type Props = {
  source: string
  base: number
}

function createFrameToken(): string {
  const bytes = new Uint8Array(16)
  crypto.getRandomValues(bytes)
  return Array.from(bytes, (byte) => byte.toString(16).padStart(2, '0')).join('')
}

export function MermaidDiagram({ source, base }: Props) {
  return <MermaidDiagramFrame key={source} source={source} base={base} />
}

function MermaidDiagramFrame({ source, base }: Props) {
  const frameRef = useRef<HTMLIFrameElement | null>(null)
  const frameToken = useMemo(createFrameToken, [])
  const [height, setHeight] = useState(0)
  const [failed, setFailed] = useState(source.length > MERMAID_DIAGRAM_MAX_SOURCE_CHARACTERS)
  const document = useMemo(
    () =>
      source.length <= MERMAID_DIAGRAM_MAX_SOURCE_CHARACTERS
        ? buildMermaidDiagramDocument(source, frameToken, '')
        : '',
    [frameToken, source]
  )

  useEffect(() => {
    const receiveMessage = (event: MessageEvent<unknown>) => {
      const frame = frameRef.current
      if (!frame || event.source !== frame.contentWindow) {
        return
      }
      const message = parseMermaidDiagramMessage(event.data, frameToken)
      if (message?.type === 'ready') {
        frame.contentWindow?.postMessage(
          {
            channel: MERMAID_DIAGRAM_ENGINE_MESSAGE_CHANNEL,
            token: frameToken,
            engine: MERMAID_WEBVIEW_ENGINE_GZIP_BASE64
          },
          '*'
        )
      } else if (message?.type === 'error') {
        setFailed(true)
      } else if (message?.type === 'rendered') {
        setHeight(message.height)
      }
    }
    window.addEventListener('message', receiveMessage)
    return () => window.removeEventListener('message', receiveMessage)
  }, [frameToken])

  return (
    <MermaidDiagramPresentation
      source={source}
      base={base}
      diagram={
        failed ? null : (
          <iframe
            ref={frameRef}
            title="Mermaid diagram"
            aria-label="Mermaid diagram"
            name={frameToken}
            srcDoc={document}
            sandbox="allow-scripts"
            referrerPolicy="no-referrer"
            style={{
              height: height || 120,
              width: '100%',
              border: 0,
              backgroundColor: colors.bgRaised
            }}
          />
        )
      }
    />
  )
}
