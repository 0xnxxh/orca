import { readFile } from 'node:fs/promises'
import { parse as parseJsonc, type ParseError } from 'jsonc-parser'
import { isPlainObject, type HooksConfig } from '../agent-hooks/installer-utils'

/**
 * Devin documents config.json as JSONC; stock JSON.parse rejects comments.
 * Async so a stalled ~/.config/devin mount cannot block the Electron main thread.
 */
export async function readDevinHooksConfig(configPath: string): Promise<HooksConfig | null> {
  let text: string
  try {
    text = await readFile(configPath, 'utf-8')
  } catch (error) {
    // Absent config is an empty config; anything else is a real read failure.
    const code = (error as NodeJS.ErrnoException | null)?.code
    return code === 'ENOENT' || code === 'ENOTDIR' ? {} : null
  }
  return parseDevinHooksConfigText(text, 'Devin config.json')
}

export function parseDevinHooksConfigText(
  text: string,
  diagnosticName: string
): HooksConfig | null {
  const errors: ParseError[] = []
  const parsed = parseJsonc(text, errors)
  if (errors.length > 0) {
    console.warn(
      `Could not parse ${diagnosticName}: ${errors.map((e) => `offset ${e.offset} length ${e.length}`).join(', ')}`
    )
    return null
  }
  if (parsed === undefined) {
    return null
  }
  return isPlainObject(parsed) ? (parsed as HooksConfig) : null
}

/** Devin imports Claude hooks by default, so surface that overlap explicitly. */
export function readConfigFromOrcaOverlapDetail(
  config: HooksConfig & { read_config_from?: unknown }
): string | null {
  if (!isClaudeConfigImportEnabled(config.read_config_from)) {
    return null
  }

  return 'Devin read_config_from.claude is enabled; imported Claude hooks may fire alongside Devin hooks.'
}

function isClaudeConfigImportEnabled(raw: unknown): boolean {
  if (raw === undefined || raw === null || raw === true) {
    return true
  }
  if (raw === false) {
    return false
  }
  if (Array.isArray(raw)) {
    return raw.includes('claude')
  }
  if (!isPlainObject(raw)) {
    return false
  }
  return raw.claude !== false
}

export function mergeHookInstallDetail(base: string | null, extra: string | null): string | null {
  if (!extra) {
    return base
  }
  if (!base) {
    return extra
  }
  return `${base} ${extra}`
}
