import { afterEach, describe, expect, it } from 'vitest'

import { buildMobileRichMarkdownEditorHtml } from '../components/mobile-rich-markdown-editor-html'
import { buildTerminalWebViewHtml } from '../terminal/terminal-webview-html'
import { escapeEmbeddedHtmlCopy } from './embedded-webview-copy'
import { mobileI18n } from './mobile-i18n'

const INITIAL_LOCALE = mobileI18n.language

afterEach(async () => {
  await mobileI18n.changeLanguage(INITIAL_LOCALE)
})

describe('embedded WebView copy', () => {
  it('escapes translated HTML text and attributes', () => {
    expect(escapeEmbeddedHtmlCopy('<Copy "all" & more>')).toBe(
      '&lt;Copy &quot;all&quot; &amp; more&gt;'
    )
  })

  it('injects localized rich-editor and terminal controls', async () => {
    await mobileI18n.changeLanguage('es')

    const editorHtml = buildMobileRichMarkdownEditorHtml()
    expect(editorHtml).toContain('data-placeholder="Empieza a escribir..."')
    expect(editorHtml).toContain('window.prompt("URL del enlace")')
    expect(editorHtml).toContain('window.prompt("URL de la imagen")')
    expect(editorHtml).toContain(`+ "Tarea" +`)

    const terminalHtml = buildTerminalWebViewHtml()
    expect(terminalHtml).toContain('id="sel-menu-copy">Copiar</button>')
    expect(terminalHtml).toContain('id="sel-menu-all">Seleccionar todo</button>')
  })
})
