import { describe, expect, it } from 'vitest'
import { decodeMobileWebFileContent } from './mobile-web-file-content'

describe('mobile web file content', () => {
  it('decodes bounded UTF-8 only after the bridge validates its base64 envelope', () => {
    const content = 'line one\nλ line two'
    const bytes = new TextEncoder().encode(content)
    const contentBase64 = btoa(String.fromCharCode(...bytes))

    expect(
      decodeMobileWebFileContent({
        workspaceId: 'workspace-1',
        relativePath: 'src/app.ts',
        contentBase64,
        truncated: false,
        byteLength: bytes.byteLength
      })
    ).toEqual({
      workspaceId: 'workspace-1',
      relativePath: 'src/app.ts',
      content,
      truncated: false,
      byteLength: bytes.byteLength
    })
  })
})
