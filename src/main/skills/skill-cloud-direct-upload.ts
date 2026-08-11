import { randomBytes } from 'node:crypto'
import { createReadStream } from 'node:fs'
import { stat } from 'node:fs/promises'
import { Readable } from 'node:stream'

type SignedPostPolicy = {
  url: string
  fields: Record<string, string>
}

function quoted(value: string): string {
  return value
    .replaceAll('\\', '\\\\')
    .replaceAll('"', '\\"')
    .replaceAll('\r', '')
    .replaceAll('\n', '')
}

function fieldBytes(boundary: string, name: string, value: string): Buffer {
  return Buffer.from(
    `--${boundary}\r\nContent-Disposition: form-data; name="${quoted(name)}"\r\n\r\n${value}\r\n`,
    'utf8'
  )
}

export async function uploadSkillPackageToSignedPolicy(input: {
  policy: SignedPostPolicy
  archivePath: string
  expectedBytes: number
  signal?: AbortSignal
  onProgress?: (bytesSent: number) => void
  fetcher?: typeof fetch
}): Promise<void> {
  const policyUrl = new URL(input.policy.url)
  if (policyUrl.protocol !== 'https:' || policyUrl.username || policyUrl.password) {
    throw new Error('skill-cloud-upload-url-invalid')
  }
  const archive = await stat(input.archivePath)
  if (!archive.isFile() || archive.size !== input.expectedBytes) {
    throw new Error('skill-cloud-upload-source-changed')
  }
  const boundary = `orca-skill-${randomBytes(18).toString('hex')}`
  const fields = Object.entries(input.policy.fields).map(([name, value]) =>
    fieldBytes(boundary, name, value)
  )
  const fileHeader = Buffer.from(
    `--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="package.tar.gz"\r\nContent-Type: application/vnd.orca.skill+tar+gzip\r\n\r\n`,
    'utf8'
  )
  const ending = Buffer.from(`\r\n--${boundary}--\r\n`, 'utf8')
  const contentLength =
    fields.reduce((total, field) => total + field.length, 0) +
    fileHeader.length +
    archive.size +
    ending.length
  async function* body() {
    for (const field of fields) {
      yield field
    }
    yield fileHeader
    let bytesSent = 0
    for await (const chunk of createReadStream(input.archivePath, { signal: input.signal })) {
      const bytes = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk)
      bytesSent += bytes.length
      if (bytesSent > input.expectedBytes) {
        throw new Error('skill-cloud-upload-source-changed')
      }
      input.onProgress?.(bytesSent)
      yield bytes
    }
    if (bytesSent !== input.expectedBytes) {
      throw new Error('skill-cloud-upload-source-changed')
    }
    yield ending
  }
  const request: RequestInit & { duplex: 'half' } = {
    method: 'POST',
    headers: {
      'content-type': `multipart/form-data; boundary=${boundary}`,
      'content-length': String(contentLength)
    },
    body: Readable.from(body()) as unknown as BodyInit,
    duplex: 'half',
    redirect: 'error',
    signal: input.signal
  }
  const response = await (input.fetcher ?? fetch)(policyUrl, request)
  if (!response.ok && response.status !== 201 && response.status !== 204) {
    throw new Error('skill-cloud-upload-failed')
  }
}
