import { createBrowserUuid } from './browser-uuid'

export const MAX_FEEDBACK_IMAGE_COUNT = 4
export const MAX_FEEDBACK_IMAGE_BYTES = 8 * 1024 * 1024
export const SUPPORTED_FEEDBACK_IMAGE_TYPES = [
  'image/png',
  'image/jpeg',
  'image/webp',
  'image/gif'
] as const

export const FEEDBACK_IMAGE_FILE_ACCEPT = SUPPORTED_FEEDBACK_IMAGE_TYPES.join(',')

export type FeedbackImageDraft = {
  id: string
  name: string
  contentType: string
  bytes: number
  data: Uint8Array
  /** Object URL for the thumbnail; revoke with releaseFeedbackImageDraft. */
  previewUrl: string
}

function isSupportedType(contentType: string): boolean {
  return (SUPPORTED_FEEDBACK_IMAGE_TYPES as readonly string[]).includes(contentType)
}

/**
 * Whether a paste should be consumed. Extraction stays broad so unsupported
 * image types still reach the rejection toast, but swallowing the paste when
 * nothing is attachable would also discard any text riding along on the
 * clipboard.
 */
export function hasAttachableFeedbackImage(files: readonly File[]): boolean {
  return files.some((file) => isSupportedType(file.type))
}

export function releaseFeedbackImageDraft(draft: FeedbackImageDraft): void {
  URL.revokeObjectURL(draft.previewUrl)
}

export function formatFeedbackImageSize(bytes: number): string {
  return bytes >= 1024 * 1024
    ? `${(bytes / (1024 * 1024)).toFixed(1)} MB`
    : `${Math.max(1, Math.round(bytes / 1024))} KB`
}

/**
 * Converts picked/pasted/dropped files into drafts. Rejections come back as
 * messages rather than being skipped, because silently dropping an attachment
 * is the exact failure this feature exists to fix.
 */
export async function readFeedbackImageFiles(
  files: readonly File[],
  existingCount: number
): Promise<{ images: FeedbackImageDraft[]; errors: string[] }> {
  const images: FeedbackImageDraft[] = []
  const errors: string[] = []
  let remaining = MAX_FEEDBACK_IMAGE_COUNT - existingCount

  try {
    for (const file of files) {
      if (!isSupportedType(file.type)) {
        errors.push(`${file.name || 'Image'} is not a supported image type.`)
        continue
      }
      if (file.size > MAX_FEEDBACK_IMAGE_BYTES) {
        errors.push(
          `${file.name || 'Image'} is larger than ${formatFeedbackImageSize(MAX_FEEDBACK_IMAGE_BYTES)}.`
        )
        continue
      }
      if (remaining <= 0) {
        errors.push(`You can attach up to ${MAX_FEEDBACK_IMAGE_COUNT} images.`)
        break
      }
      remaining -= 1
      images.push({
        // Why: crypto.randomUUID is undefined in non-secure browser contexts (LAN
        // web client over plain HTTP); createBrowserUuid falls back safely.
        id: `${file.name}-${file.size}-${createBrowserUuid()}`,
        name: file.name || 'pasted-image',
        contentType: file.type,
        bytes: file.size,
        data: new Uint8Array(await file.arrayBuffer()),
        previewUrl: URL.createObjectURL(file)
      })
    }
  } catch (error) {
    // Why: a rejected read never returns these drafts, and an un-revoked object
    // URL pins its blob for the life of the renderer.
    images.forEach(releaseFeedbackImageDraft)
    throw error
  }

  return { images, errors }
}

export function extractImageFilesFromDataTransfer(data: DataTransfer | null): File[] {
  if (!data) {
    return []
  }
  return Array.from(data.files).filter((file) => file.type.startsWith('image/'))
}
