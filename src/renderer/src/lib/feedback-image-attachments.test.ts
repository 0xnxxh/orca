// @vitest-environment happy-dom

import { beforeEach, describe, expect, it, vi } from 'vitest'
import {
  MAX_FEEDBACK_IMAGE_BYTES,
  MAX_FEEDBACK_IMAGE_COUNT,
  hasAttachableFeedbackImage,
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

describe('hasAttachableFeedbackImage', () => {
  it('is true when any file is an allow-listed type', () => {
    const svg = new File(['x'], 'a.svg', { type: 'image/svg+xml' })
    expect(hasAttachableFeedbackImage([svg, pngFile('a.png')])).toBe(true)
  })

  // Why: the paste handler only consumes the event when this is true. An
  // image/* type outside the allow-list must still fall through so co-pasted
  // text is not swallowed, while readFeedbackImageFiles raises its toast.
  it('is false when every file is an unsupported image type', () => {
    const svg = new File(['x'], 'a.svg', { type: 'image/svg+xml' })
    const bmp = new File(['x'], 'a.bmp', { type: 'image/bmp' })
    expect(hasAttachableFeedbackImage([svg, bmp])).toBe(false)
  })

  it('is false for an empty selection', () => {
    expect(hasAttachableFeedbackImage([])).toBe(false)
  })

  it('is false when supported files cannot pass validation', () => {
    expect(hasAttachableFeedbackImage([pngFile('empty.png', 0)])).toBe(false)
    expect(hasAttachableFeedbackImage([pngFile('huge.png', MAX_FEEDBACK_IMAGE_BYTES + 1)])).toBe(
      false
    )
    expect(hasAttachableFeedbackImage([pngFile('a.png')], MAX_FEEDBACK_IMAGE_COUNT)).toBe(false)
  })
})

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

  it('caps rejection detail so a large drop cannot mount one toast per file', async () => {
    const files = Array.from(
      { length: 100 },
      (_, index) => new File(['x'], `image-${index}.svg`, { type: 'image/svg+xml' })
    )

    const { images, errors } = await readFeedbackImageFiles(files, 0)

    expect(images).toEqual([])
    expect(errors).toHaveLength(5)
    expect(errors.at(-1)).toBe('96 additional images could not be attached.')
  })

  it('reports an oversized image instead of skipping it', async () => {
    const { images, errors } = await readFeedbackImageFiles(
      [pngFile('huge.png', MAX_FEEDBACK_IMAGE_BYTES + 1)],
      0
    )

    expect(images).toEqual([])
    expect(errors).toEqual(['huge.png is larger than 8.0 MB.'])
  })

  it('reports an empty image instead of deferring rejection until submit', async () => {
    const { images, errors } = await readFeedbackImageFiles([pngFile('empty.png', 0)], 0)

    expect(images).toEqual([])
    expect(errors).toEqual(['empty.png is empty.'])
  })

  it('reports the overflow once the running count is already at capacity', async () => {
    const { images, errors } = await readFeedbackImageFiles(
      [pngFile('a.png')],
      MAX_FEEDBACK_IMAGE_COUNT
    )

    expect(images).toEqual([])
    expect(errors).toEqual([`You can attach up to ${MAX_FEEDBACK_IMAGE_COUNT} images.`])
  })

  it('revokes previews already created when a later read in the batch fails', async () => {
    const good = pngFile('good.png')
    const broken = pngFile('broken.png')
    broken.arrayBuffer = () => Promise.reject(new Error('file went away'))

    await expect(readFeedbackImageFiles([good, broken], 0)).rejects.toThrow('file went away')
    expect(URL.revokeObjectURL).toHaveBeenCalledWith('blob:feedback-1')
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
