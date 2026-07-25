// @vitest-environment happy-dom

import { beforeEach, describe, expect, it, vi } from 'vitest'
import {
  MAX_FEEDBACK_IMAGE_BYTES,
  MAX_FEEDBACK_IMAGE_COUNT,
  readFeedbackImageFiles
} from './feedback-image-attachments'

beforeEach(() => {
  let next = 0
  URL.createObjectURL = vi.fn(() => `blob:feedback-${(next += 1)}`)
  URL.revokeObjectURL = vi.fn()
})

function pngFile(name: string, size = 8): File {
  const file = new File(['x'], name, { type: 'image/png' })
  Object.defineProperty(file, 'size', { value: size })
  return file
}

describe('readFeedbackImageFiles', () => {
  it('reads supported images into drafts with distinct ids', async () => {
    const { images, errors } = await readFeedbackImageFiles([pngFile('a.png'), pngFile('a.png')], 0)

    expect(errors).toEqual([])
    expect(images).toHaveLength(2)
    expect(new Set(images.map((image) => image.id)).size).toBe(2)
    expect(images[0].data.byteLength).toBe(1)
  })

  it('reports an unsupported type instead of skipping it', async () => {
    const { images, errors } = await readFeedbackImageFiles(
      [new File(['x'], 'notes.pdf', { type: 'application/pdf' })],
      0
    )

    expect(images).toEqual([])
    expect(errors).toEqual(['notes.pdf is not a supported image type.'])
  })

  it('reports an oversized image instead of skipping it', async () => {
    const { images, errors } = await readFeedbackImageFiles(
      [pngFile('huge.png', MAX_FEEDBACK_IMAGE_BYTES + 1)],
      0
    )

    expect(images).toEqual([])
    expect(errors).toEqual(['huge.png is larger than 8.0 MB.'])
  })

  it('reports the overflow once the running count is already at capacity', async () => {
    const { images, errors } = await readFeedbackImageFiles(
      [pngFile('a.png')],
      MAX_FEEDBACK_IMAGE_COUNT
    )

    expect(images).toEqual([])
    expect(errors).toEqual([`You can attach up to ${MAX_FEEDBACK_IMAGE_COUNT} images.`])
  })

  it('does not depend on crypto.randomUUID, which LAN web clients do not expose', async () => {
    const realCrypto = globalThis.crypto
    Object.defineProperty(globalThis, 'crypto', {
      configurable: true,
      value: { getRandomValues: realCrypto.getRandomValues.bind(realCrypto) }
    })
    try {
      const { images, errors } = await readFeedbackImageFiles([pngFile('a.png')], 0)
      expect(errors).toEqual([])
      expect(images).toHaveLength(1)
    } finally {
      Object.defineProperty(globalThis, 'crypto', { configurable: true, value: realCrypto })
    }
  })
})
