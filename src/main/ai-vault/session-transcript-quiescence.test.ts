import { mkdtemp, rm, utimes, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { AI_VAULT_SESSION_QUIESCENCE_MS } from '../../shared/ai-vault-session-deletion'
import {
  qualifyAiVaultSessionLiveness,
  readAiVaultTranscriptFingerprint
} from './session-transcript-quiescence'

const fixtureRoots: string[] = []
const NOW_MS = 1_770_000_000_000

async function writeTranscript(contents: string, ageMs: number): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), 'orca-ai-vault-quiescence-'))
  fixtureRoots.push(root)
  const filePath = join(root, 'session.jsonl')
  await writeFile(filePath, contents)
  const writtenAt = new Date(NOW_MS - ageMs)
  await utimes(filePath, writtenAt, writtenAt)
  return filePath
}

async function qualify(
  filePath: string,
  overrides: Partial<Parameters<typeof qualifyAiVaultSessionLiveness>[0]> = {}
) {
  return qualifyAiVaultSessionLiveness({
    liveness: 'not-live',
    filePath,
    observedBefore: await readAiVaultTranscriptFingerprint(filePath),
    nowMs: NOW_MS,
    ...overrides
  })
}

afterEach(async () => {
  await Promise.all(
    fixtureRoots.splice(0).map((root) => rm(root, { recursive: true, force: true }))
  )
})

describe('qualifyAiVaultSessionLiveness', () => {
  it('confirms not-live once the transcript has been quiet for the whole window', async () => {
    const filePath = await writeTranscript('{"sessionId":"s"}\n', AI_VAULT_SESSION_QUIESCENCE_MS)

    await expect(qualify(filePath)).resolves.toBe('not-live')
  })

  // The release regression: an agent Orca never spawned owns the transcript, so
  // the PTY inventory and status snapshot are both empty and report not-live.
  it('fails closed for a transcript written moments ago by an unmanaged owner', async () => {
    const filePath = await writeTranscript('{"sessionId":"s"}\n', 1_000)

    await expect(qualify(filePath)).resolves.toBe('unknown')
  })

  it('fails closed when the transcript is appended to during liveness inspection', async () => {
    const filePath = await writeTranscript(
      '{"sessionId":"s"}\n',
      AI_VAULT_SESSION_QUIESCENCE_MS * 2
    )
    const observedBefore = await readAiVaultTranscriptFingerprint(filePath)
    // Same mtime, more bytes: a coarse-timestamp filesystem hides the write.
    await writeFile(filePath, '{"sessionId":"s"}\n{"role":"user"}\n')
    const writtenAt = new Date(NOW_MS - AI_VAULT_SESSION_QUIESCENCE_MS * 2)
    await utimes(filePath, writtenAt, writtenAt)

    await expect(qualify(filePath, { observedBefore })).resolves.toBe('unknown')
  })

  it('fails closed when the transcript stops being readable mid-authorization', async () => {
    const filePath = await writeTranscript('{"sessionId":"s"}\n', AI_VAULT_SESSION_QUIESCENCE_MS)
    const observedBefore = await readAiVaultTranscriptFingerprint(filePath)
    await rm(filePath)

    await expect(qualify(filePath, { observedBefore })).resolves.toBe('unknown')
  })

  it('fails closed when no fingerprint was captured before inspection', async () => {
    const filePath = await writeTranscript('{"sessionId":"s"}\n', AI_VAULT_SESSION_QUIESCENCE_MS)

    await expect(qualify(filePath, { observedBefore: null })).resolves.toBe('unknown')
  })

  // A transcript stamped in the future (clock skew, or a WSL/9P mount whose
  // clock runs ahead) can never satisfy the window.
  it('fails closed for a future write time', async () => {
    const filePath = await writeTranscript('{"sessionId":"s"}\n', -60_000)

    await expect(qualify(filePath)).resolves.toBe('unknown')
  })

  it.each(['live', 'unknown'] as const)('passes %s through untouched', async (liveness) => {
    const filePath = await writeTranscript('{"sessionId":"s"}\n', AI_VAULT_SESSION_QUIESCENCE_MS)

    await expect(qualify(filePath, { liveness })).resolves.toBe(liveness)
  })
})

describe('readAiVaultTranscriptFingerprint', () => {
  it('reads mtime and size for a regular file', async () => {
    const filePath = await writeTranscript('12345', AI_VAULT_SESSION_QUIESCENCE_MS)

    await expect(readAiVaultTranscriptFingerprint(filePath)).resolves.toEqual({
      mtimeMs: NOW_MS - AI_VAULT_SESSION_QUIESCENCE_MS,
      sizeBytes: 5
    })
  })

  it('returns null for a directory and for a missing path', async () => {
    const filePath = await writeTranscript('x', 0)
    const dir = join(filePath, '..')

    await expect(readAiVaultTranscriptFingerprint(dir)).resolves.toBeNull()
    await expect(readAiVaultTranscriptFingerprint(join(dir, 'absent.jsonl'))).resolves.toBeNull()
  })
})
