import { readFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import type { Plugin } from 'vite'

const CANONICAL_STYLE_PATH = resolve('src/renderer/src/assets/main.css')
const MOBILE_WEB_RENDERER_STYLE_SOURCES = [
  "@source '../components/ui/badge.tsx';",
  "@source '../components/ui/button.tsx';",
  "@source '../components/ui/card.tsx';",
  "@source '../components/ui/dialog-foundation.tsx';",
  "@source '../components/ui/input.tsx';",
  "@source '../components/ui/select.tsx';",
  "@source '../components/ui/tabs.tsx';"
]
const DESKTOP_ONLY_IMPORTS = [
  "@import '@xterm/xterm/css/xterm.css';",
  "@import 'katex/dist/katex.min.css';",
  "@import './rich-markdown-editor.css';",
  "@import './markdown-preview.css';",
  "@import './terminal.css';",
  "@import './mobile-page.css';"
]
const DESKTOP_SYMBOL_FONT =
  /\n@font-face \{\n  font-family: 'Orca Nerd Font Symbols';[\s\S]*?\n\}\n/

export function createMobileWebStyleBoundaryPlugin(): Plugin {
  return {
    name: 'orca-mobile-web-style-boundary',
    enforce: 'pre',
    async load(id) {
      if (id.split('?')[0] !== CANONICAL_STYLE_PATH) {
        return null
      }
      const source = await readFile(CANONICAL_STYLE_PATH, 'utf8')
      const withoutDesktopImports = source
        .split('\n')
        .filter((line) => !DESKTOP_ONLY_IMPORTS.includes(line))
        .join('\n')
      const withApprovedSources = withoutDesktopImports.replace(
        "@import 'tailwindcss';",
        ["@import 'tailwindcss';", ...MOBILE_WEB_RENDERER_STYLE_SOURCES].join('\n')
      )
      if (withApprovedSources === withoutDesktopImports) {
        this.error('Canonical styles no longer contain the expected Tailwind import')
      }
      const mobileStyles = withApprovedSources.replace(DESKTOP_SYMBOL_FONT, '\n')
      if (mobileStyles === withApprovedSources) {
        this.error('Canonical styles no longer contain the expected desktop symbol font block')
      }
      return mobileStyles
    }
  }
}
