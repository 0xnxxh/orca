import { createHash, randomUUID } from 'node:crypto'
import { createReadStream } from 'node:fs'
import { mkdir, open, rm, stat, type FileHandle } from 'node:fs/promises'
import { join } from 'node:path'
import { SKILL_PACKAGE_MAX_COMPRESSED_BYTES } from '../../shared/skill-package-manifest'
import {
  SKILL_UPLOAD_CHUNK_MAX_BYTES,
  type SkillUploadBeginRequest,
  type SkillUploadChunkRequest
} from '../../shared/skill-upload-session-contract'

const MAX_SESSIONS = 4
const SESSION_IDLE_MS = 10 * 60_000

type UploadSession = {
  id: string
  path: string
  package: SkillUploadBeginRequest['package']
  handle: FileHandle | null
  bytesReceived: number
  touchedAt: number
  committed: boolean
}

export class SkillUploadSessionService {
  private readonly sessions = new Map<string, UploadSession>()
  private initialized: Promise<void> | null = null

  constructor(private readonly root: string) {}

  async begin(request: SkillUploadBeginRequest): Promise<{ uploadId: string; chunkBytes: number }> {
    await this.initialize()
    await this.prune()
    if (this.sessions.size >= MAX_SESSIONS) {
      throw new Error('skill-upload-session-limit')
    }
    const id = randomUUID()
    const path = join(this.root, `${id}.tar.gz`)
    const handle = await open(path, 'wx+', 0o600)
    this.sessions.set(id, {
      id,
      path,
      package: request.package,
      handle,
      bytesReceived: 0,
      touchedAt: Date.now(),
      committed: false
    })
    return { uploadId: id, chunkBytes: SKILL_UPLOAD_CHUNK_MAX_BYTES }
  }

  async append(request: SkillUploadChunkRequest): Promise<{ acknowledgedOffset: number }> {
    const session = this.requireActive(request.uploadId)
    const bytes = Buffer.from(request.bytesBase64, 'base64')
    if (
      bytes.length === 0 ||
      bytes.length > SKILL_UPLOAD_CHUNK_MAX_BYTES ||
      bytes.toString('base64') !== request.bytesBase64
    ) {
      throw new Error('skill-upload-chunk-invalid')
    }
    if (request.offset > session.bytesReceived) {
      throw new Error('skill-upload-offset-invalid')
    }
    if (request.offset < session.bytesReceived) {
      if (request.offset + bytes.length > session.bytesReceived || !session.handle) {
        throw new Error('skill-upload-offset-invalid')
      }
      const existing = Buffer.alloc(bytes.length)
      const read = await session.handle.read(existing, 0, existing.length, request.offset)
      if (read.bytesRead !== bytes.length || !existing.equals(bytes)) {
        throw new Error('skill-upload-retry-mismatch')
      }
      session.touchedAt = Date.now()
      return { acknowledgedOffset: session.bytesReceived }
    }
    if (session.bytesReceived + bytes.length > session.package.compressedBytes) {
      throw new Error('skill-upload-size-limit')
    }
    const write = await session.handle!.write(bytes, 0, bytes.length, request.offset)
    if (write.bytesWritten !== bytes.length) {
      throw new Error('skill-upload-write-incomplete')
    }
    session.bytesReceived += bytes.length
    session.touchedAt = Date.now()
    return { acknowledgedOffset: session.bytesReceived }
  }

  async commit(uploadId: string): Promise<{ uploadId: string }> {
    const session = this.requireActive(uploadId)
    if (session.bytesReceived !== session.package.compressedBytes || !session.handle) {
      throw new Error('skill-upload-size-mismatch')
    }
    await session.handle.sync()
    await session.handle.close()
    session.handle = null
    const identity = await this.hash(session.path)
    if (identity !== session.package.archiveSha256) {
      await this.cancel(uploadId)
      throw new Error('skill-upload-archive-hash-mismatch')
    }
    session.committed = true
    session.touchedAt = Date.now()
    return { uploadId }
  }

  async take(
    uploadId: string,
    identity: SkillUploadBeginRequest['package']
  ): Promise<{ archivePath: string; cleanup(): Promise<void> }> {
    const session = this.sessions.get(uploadId)
    if (!session?.committed || JSON.stringify(session.package) !== JSON.stringify(identity)) {
      throw new Error('skill-upload-session-unavailable')
    }
    session.touchedAt = Date.now()
    return {
      archivePath: session.path,
      cleanup: () => this.cancel(uploadId)
    }
  }

  async cancel(uploadId: string): Promise<void> {
    const session = this.sessions.get(uploadId)
    if (!session) {
      return
    }
    this.sessions.delete(uploadId)
    await session.handle?.close().catch(() => undefined)
    await rm(session.path, { force: true })
  }

  private requireActive(uploadId: string): UploadSession {
    const session = this.sessions.get(uploadId)
    if (!session || session.committed || Date.now() - session.touchedAt > SESSION_IDLE_MS) {
      throw new Error('skill-upload-session-unavailable')
    }
    return session
  }

  private async initialize(): Promise<void> {
    this.initialized ??= (async () => {
      await rm(this.root, { recursive: true, force: true })
      await mkdir(this.root, { recursive: true, mode: 0o700 })
    })()
    return this.initialized
  }

  private async prune(): Promise<void> {
    const expired = [...this.sessions.values()]
      .filter((session) => Date.now() - session.touchedAt > SESSION_IDLE_MS)
      .map((session) => session.id)
    await Promise.all(expired.map((id) => this.cancel(id)))
  }

  private async hash(path: string): Promise<string> {
    const size = (await stat(path)).size
    if (size < 1 || size > SKILL_PACKAGE_MAX_COMPRESSED_BYTES) {
      throw new Error('skill-upload-size-limit')
    }
    const hash = createHash('sha256')
    for await (const chunk of createReadStream(path)) {
      hash.update(chunk as Buffer)
    }
    return hash.digest('hex')
  }
}
