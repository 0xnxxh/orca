// @vitest-environment happy-dom

import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { createElement } from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { MobileWebFileDocument } from './mobile-web-file-document'
import { MobileWebRasterImagePreview } from './mobile-web-raster-image-preview'

const createObjectURL = vi.fn()
const revokeObjectURL = vi.fn()

beforeEach(() => {
  createObjectURL
    .mockReset()
    .mockReturnValueOnce('blob:private-one')
    .mockReturnValue('blob:private-two')
  revokeObjectURL.mockReset()
  vi.stubGlobal('URL', { createObjectURL, revokeObjectURL })
})

afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
})

describe('MobileWebRasterImagePreview', () => {
  it('renders validated bytes from a private object URL and revokes every generation', () => {
    const view = render(
      createElement(MobileWebRasterImagePreview, { document: pngDocument('assets/one.png') })
    )
    const image = screen.getByRole('img', { name: 'Preview of one.png' })

    expect(image.getAttribute('src')).toBe('blob:private-one')
    expect(image.getAttribute('src')).not.toContain('assets/one.png')
    expect(image.getAttribute('data-raster-mime')).toBe('image/png')
    expect(createObjectURL).toHaveBeenCalledTimes(1)

    view.rerender(
      createElement(MobileWebRasterImagePreview, { document: pngDocument('assets/two.png') })
    )
    expect(revokeObjectURL).toHaveBeenCalledWith('blob:private-one')
    expect(screen.getByRole('img', { name: 'Preview of two.png' }).getAttribute('src')).toBe(
      'blob:private-two'
    )

    view.unmount()
    expect(revokeObjectURL).toHaveBeenLastCalledWith('blob:private-two')
  })

  it('rejects mismatched signatures before creating an object URL', () => {
    render(
      createElement(MobileWebRasterImagePreview, {
        document: pngDocument('assets/not-really.png', new TextEncoder().encode('<svg/>'))
      })
    )

    expect(
      screen.getByText('The file signature does not match its raster image extension.')
    ).toBeDefined()
    expect(screen.queryByRole('img')).toBeNull()
    expect(createObjectURL).not.toHaveBeenCalled()
  })

  it('replaces a browser decode failure with an inert error state', () => {
    render(
      createElement(MobileWebRasterImagePreview, {
        document: pngDocument('assets/broken.png')
      })
    )
    fireEvent.error(screen.getByRole('img'))

    expect(screen.getByRole('alert').textContent).toContain('This image could not be decoded.')
    expect(screen.queryByRole('img')).toBeNull()
  })
})

function pngDocument(
  relativePath: string,
  bytes = Uint8Array.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])
): MobileWebFileDocument {
  return {
    workspaceId: 'workspace-1',
    relativePath,
    bytes,
    content: '',
    kind: 'binary',
    eof: true,
    limitReached: false,
    revision: null
  }
}
