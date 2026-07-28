import { FileWarning, ImageOff } from 'lucide-react'
import React, { useEffect, useMemo, useState } from 'react'
import type { MobileWebFileDocument } from './mobile-web-file-document'
import {
  MOBILE_WEB_RASTER_IMAGE_MAX_BYTES,
  validateMobileWebRasterImage
} from './mobile-web-raster-image'

export function MobileWebRasterImagePreview({
  document
}: {
  document: MobileWebFileDocument
}): React.JSX.Element {
  const validation = useMemo(
    () =>
      validateMobileWebRasterImage({
        relativePath: document.relativePath,
        bytes: document.bytes,
        eof: document.eof,
        limitReached: document.limitReached
      }),
    [document.bytes, document.eof, document.limitReached, document.relativePath]
  )
  const source = useMobileWebRasterImageUrl(
    document,
    validation.valid && validation.imageType.mimeType
  )
  const [decodeFailed, setDecodeFailed] = useState(false)

  useEffect(() => {
    setDecodeFailed(false)
  }, [source])

  if (!validation.valid) {
    return (
      <p className="flex items-center gap-2 border-t border-border px-6 py-6 text-xs text-muted-foreground">
        <FileWarning className="size-4" />
        {imageValidationCopy(validation.reason)}
      </p>
    )
  }
  if (!source) {
    return (
      <p
        role="status"
        className="flex items-center gap-2 border-t border-border px-6 py-6 text-xs text-muted-foreground"
      >
        Preparing image preview
      </p>
    )
  }
  if (decodeFailed) {
    return (
      <p
        role="alert"
        className="flex items-center gap-2 border-t border-border px-6 py-6 text-xs text-muted-foreground"
      >
        <ImageOff className="size-4" />
        This image could not be decoded.
      </p>
    )
  }
  return (
    <div className="flex max-h-96 justify-center overflow-auto border-t border-border bg-[var(--editor-surface)] p-4 scrollbar-editor">
      <img
        src={source}
        alt={`Preview of ${basename(document.relativePath)}`}
        className="max-h-full max-w-full object-contain"
        draggable={false}
        data-raster-mime={validation.imageType.mimeType}
        onError={() => setDecodeFailed(true)}
      />
    </div>
  )
}

function useMobileWebRasterImageUrl(
  document: MobileWebFileDocument,
  mimeType: string | false
): string | null {
  const [source, setSource] = useState<{
    bytes: Uint8Array
    mimeType: string
    objectUrl: string
  } | null>(null)

  useEffect(() => {
    if (!mimeType) {
      setSource(null)
      return
    }
    const bytes = document.bytes.slice().buffer
    const objectUrl = URL.createObjectURL(new Blob([bytes], { type: mimeType }))
    setSource({ bytes: document.bytes, mimeType, objectUrl })
    return () => URL.revokeObjectURL(objectUrl)
  }, [document.bytes, mimeType])

  return source?.bytes === document.bytes && source.mimeType === mimeType ? source.objectUrl : null
}

function imageValidationCopy(
  reason: 'unsupported' | 'incomplete' | 'too_large' | 'signature_mismatch'
): string {
  if (reason === 'too_large') {
    return `Image preview stopped at the ${formatMegabytes(
      MOBILE_WEB_RASTER_IMAGE_MAX_BYTES
    )} mobile image limit.`
  }
  if (reason === 'signature_mismatch') {
    return 'The file signature does not match its raster image extension.'
  }
  if (reason === 'incomplete') {
    return 'The complete image is required before it can be previewed.'
  }
  return 'Only PNG, JPEG, GIF, WebP, BMP, and ICO images can be previewed.'
}

function basename(relativePath: string): string {
  return relativePath.split(/[\\/]/).at(-1) ?? 'image'
}

function formatMegabytes(bytes: number): string {
  return `${bytes / (1024 * 1024)} MiB`
}
