import { readFile, readdir } from 'node:fs/promises'
import { join } from 'node:path'
import type { AiVaultSession } from '../../shared/ai-vault-types'
import type { FileWithMtime, SessionAccumulator } from './session-scanner-types'
import {
  addPreviewMessage,
  createAccumulator,
  finalizeSession,
  seedFullFirstUserPrompt,
  sessionIdFromFileName,
  updateTimeline
} from './session-scanner-accumulator'
import { extractFullFirstUserPromptText } from './session-scanner-first-user-prompt'
import {
  asRecord,
  extractPreviewContentText,
  extractString,
  findOpenCodeStorageRoot,
  normalizeTitleText,
  timeObjectValue,
  tokenTotal
} from './session-scanner-values'

export async function parseOpenCodeSessionFile(
  file: FileWithMtime,
  platform: NodeJS.Platform = process.platform
): Promise<AiVaultSession | null> {
  const record = asRecord(JSON.parse(await readFile(file.path, 'utf-8')) as unknown)
  if (!record) {
    return null
  }
  const sessionId = extractString(record.id) ?? sessionIdFromFileName(file.path)
  const accumulator = createAccumulator({ agent: 'opencode', file, sessionId })
  accumulator.title = normalizeTitleText(extractString(record.title) ?? '')
  accumulator.cwd = extractString(record.directory)
  updateTimeline(accumulator, timeObjectValue(record.time, 'created'))
  updateTimeline(accumulator, timeObjectValue(record.time, 'updated'))
  await consumeOpenCodeMessages(accumulator, findOpenCodeStorageRoot(file.path), sessionId)
  return finalizeSession(accumulator, platform)
}

export async function consumeOpenCodeMessages(
  accumulator: SessionAccumulator,
  storageRoot: string | null,
  sessionId: string
): Promise<void> {
  if (!storageRoot) {
    return
  }
  const messageDir = join(storageRoot, 'message', sessionId)
  let entries
  try {
    entries = await readdir(messageDir, { withFileTypes: true })
  } catch {
    return
  }
  for (const entry of entries) {
    if (!entry.isFile() || !entry.name.endsWith('.json')) {
      continue
    }
    const message = asRecord(
      JSON.parse(await readFile(join(messageDir, entry.name), 'utf-8')) as unknown
    )
    if (!message) {
      continue
    }
    const role = extractString(message.role)
    if (role === 'user' || role === 'assistant') {
      accumulator.messageCount++
      updateTimeline(accumulator, timeObjectValue(message.time, 'created'))
      const summary = asRecord(message.summary)
      if (role === 'user') {
        accumulator.title ??= extractString(summary?.title) ?? extractString(summary?.body)
      }
      // Why: the summary fallbacks are AI-generated. Seed the copyable first
      // prompt from real typed content only, never from a summary of a
      // harness-injected turn. Extraction stays inside the thunk so list scans
      // (capture mode `none`) never pay for it.
      seedFullFirstUserPrompt(accumulator, role, () =>
        extractFullFirstUserPromptText(message.content)
      )
      addPreviewMessage(accumulator, {
        role,
        text:
          extractPreviewContentText(message.content) ??
          extractString(summary?.body) ??
          extractString(summary?.title),
        timestamp: timeObjectValue(message.time, 'created'),
        seedFirstUserPrompt: false
      })
      accumulator.model =
        extractString(asRecord(message.model)?.modelID) ||
        extractString(message.modelID) ||
        accumulator.model
      accumulator.totalTokens += tokenTotal(message.tokens)
    }
  }
}
