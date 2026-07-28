import { describe, expect, it } from 'vitest'
import {
  buildMobileWebFileSyntax,
  MOBILE_WEB_SYNTAX_MAX_CHARACTERS,
  mobileWebSyntaxLanguage
} from './mobile-web-file-syntax'

describe('mobile web file syntax', () => {
  it('detects curated languages and degrades unsupported files to plaintext', () => {
    expect(mobileWebSyntaxLanguage('src/app.TSX')).toBe('typescript')
    expect(mobileWebSyntaxLanguage('scripts/release.sh')).toBe('bash')
    expect(mobileWebSyntaxLanguage('Dockerfile')).toBe('bash')
    expect(mobileWebSyntaxLanguage('src/main.rs')).toBe('plaintext')
  })

  it('highlights source without changing or interpreting its text', () => {
    const content = 'const answer: number = 42\n// <script>still text</script>'
    const syntax = buildMobileWebFileSyntax('src/app.ts', content)

    expect(syntax.highlighted).toBe(true)
    expect(syntax.segments.map((segment) => segment.text).join('')).toBe(content)
    expect(syntax.segments.some((segment) => segment.kind === 'keyword')).toBe(true)
    expect(syntax.segments.some((segment) => segment.kind === 'comment')).toBe(true)
  })

  it('bounds highlighting while retaining the complete loaded source', () => {
    const content = `const first = 1\n${'const value = 2\n'.repeat(
      MOBILE_WEB_SYNTAX_MAX_CHARACTERS
    )}`
    const syntax = buildMobileWebFileSyntax('large.ts', content)

    expect(syntax.segments.map((segment) => segment.text).join('')).toBe(content)
    expect(syntax.segments.at(-1)?.kind).toBe('plain')
  })
})
