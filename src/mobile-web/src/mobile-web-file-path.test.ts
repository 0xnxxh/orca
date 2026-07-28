import { describe, expect, it } from 'vitest'
import { joinMobileWebFilePath, mobileWebFileBreadcrumbs } from './mobile-web-file-path'

describe('mobile web file paths', () => {
  it('joins relative directory entries and derives navigable breadcrumbs', () => {
    expect(joinMobileWebFilePath('', 'src')).toBe('src')
    expect(joinMobileWebFilePath('src/components', 'button.tsx')).toBe('src/components/button.tsx')
    expect(mobileWebFileBreadcrumbs('src/components')).toEqual([
      { label: 'Workspace', relativePath: '' },
      { label: 'src', relativePath: 'src' },
      { label: 'components', relativePath: 'src/components' }
    ])
  })
})
