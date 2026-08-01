import { safeStorage } from 'electron'
import { existsSync, readFileSync } from 'node:fs'
import { access, mkdir, rm, writeFile } from 'node:fs/promises'
import { homedir } from 'node:os'
import { join } from 'node:path'

type StoredOpenAiKey = {
  encryptedKeyBase64: string
}

const OPENAI_SPEECH_TOKEN_FILE = 'openai-speech-token.enc'
let cachedOpenAiSpeechApiKey: string | null = null
// Why: async writes lose the single-thread ordering the sync twin had; chain them so save/clear land in call order.
let pendingOpenAiKeyWrite: Promise<void> = Promise.resolve()
// Why: the chain orders the fs ops but not the cache, whose writes happen after an await;
// the last caller wins the cache so a clear can't be undone by an already-queued save.
let openAiKeyCacheGeneration = 0

function getOrcaDir(): string {
  return join(homedir(), '.orca')
}

function getOpenAiKeyPath(): string {
  return join(getOrcaDir(), OPENAI_SPEECH_TOKEN_FILE)
}

function parseLegacyJsonStoredOpenAiKey(contents: string): StoredOpenAiKey | null {
  try {
    const parsed = JSON.parse(contents) as Partial<StoredOpenAiKey>
    if (typeof parsed.encryptedKeyBase64 !== 'string' || parsed.encryptedKeyBase64 === '') {
      return null
    }
    return { encryptedKeyBase64: parsed.encryptedKeyBase64 }
  } catch {
    return null
  }
}

/** Sync twin kept for the model-state snapshot builder, which is synchronous. */
export function hasOpenAiSpeechApiKey(): boolean {
  // Why: Settings and model-state refresh call this on startup; checking file
  // existence avoids decrypting safeStorage and triggering macOS keychain prompts.
  return existsSync(getOpenAiKeyPath())
}

export async function hasOpenAiSpeechApiKeyAsync(): Promise<boolean> {
  try {
    await access(getOpenAiKeyPath())
    return true
  } catch {
    return false
  }
}

function encodeOpenAiKeyForStorage(apiKey: string): { trimmed: string; contents: string | Buffer } {
  const trimmed = apiKey.trim()
  if (!trimmed) {
    throw new Error('OpenAI API key is required')
  }
  if (safeStorage.isEncryptionAvailable()) {
    return { trimmed, contents: safeStorage.encryptString(trimmed) }
  }
  console.warn(
    '[speech] safeStorage encryption unavailable — storing OpenAI speech key in plaintext'
  )
  return { trimmed, contents: trimmed }
}

export function saveOpenAiSpeechApiKeyAsync(apiKey: string): Promise<void> {
  const { trimmed, contents } = encodeOpenAiKeyForStorage(apiKey)
  const generation = ++openAiKeyCacheGeneration
  return chainOpenAiKeyWrite(async () => {
    // Why: recursive mkdir is idempotent, so the existsSync probe was a wasted syscall.
    await mkdir(getOrcaDir(), { recursive: true })
    // Why: mode on the CREATE, not a later chmod, so the key is never briefly world-readable.
    await writeFile(getOpenAiKeyPath(), contents, { mode: 0o600 })
    if (generation === openAiKeyCacheGeneration) {
      cachedOpenAiSpeechApiKey = trimmed
    }
  })
}

/** Sync twin kept: SttService passes this as a lazy credential callback into the cloud session. */
export function readOpenAiSpeechApiKey(): string {
  if (cachedOpenAiSpeechApiKey !== null) {
    return cachedOpenAiSpeechApiKey
  }
  let raw: Buffer
  try {
    // Why: one read replaces existsSync + two readFileSync passes (the legacy-JSON probe re-read the same file).
    raw = readFileSync(getOpenAiKeyPath())
  } catch (error) {
    const code = (error as NodeJS.ErrnoException | null)?.code
    if (code === 'ENOENT' || code === 'ENOTDIR') {
      throw new Error('OpenAI API key is not configured')
    }
    throw new Error('OpenAI API key could not be decrypted')
  }
  cachedOpenAiSpeechApiKey = decodeStoredOpenAiKey(raw)
  return cachedOpenAiSpeechApiKey
}

function decodeStoredOpenAiKey(raw: Buffer): string {
  try {
    const legacyJson = parseLegacyJsonStoredOpenAiKey(raw.toString('utf8'))
    if (legacyJson) {
      return safeStorage.decryptString(Buffer.from(legacyJson.encryptedKeyBase64, 'base64'))
    }
    return safeStorage.isEncryptionAvailable()
      ? safeStorage.decryptString(raw)
      : raw.toString('utf8')
  } catch {
    throw new Error('OpenAI API key could not be decrypted')
  }
}

export function clearOpenAiSpeechApiKeyAsync(): Promise<void> {
  const generation = ++openAiKeyCacheGeneration
  cachedOpenAiSpeechApiKey = null
  return chainOpenAiKeyWrite(async () => {
    await rm(getOpenAiKeyPath(), { force: true })
    // Why: a sync read can repopulate the cache from disk while we wait for our turn.
    if (generation === openAiKeyCacheGeneration) {
      cachedOpenAiSpeechApiKey = null
    }
  })
}

function chainOpenAiKeyWrite(run: () => Promise<void>): Promise<void> {
  const next = pendingOpenAiKeyWrite.then(run, run)
  pendingOpenAiKeyWrite = next.then(
    () => undefined,
    () => undefined
  )
  return next
}
