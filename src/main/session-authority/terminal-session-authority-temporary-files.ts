import { opendir, rm } from 'node:fs/promises'
import path from 'node:path'

const TEMPORARY_SUFFIX = /\.\d+\.[0-9a-f-]{36}\.tmp$/iu

export async function removeAuthorityCrashTemporaryFiles(
  directory: string,
  targetNames: readonly string[]
): Promise<void> {
  const prefixes = targetNames.map((name) => `${name}.`)
  let entries
  try {
    entries = await opendir(directory)
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
      return
    }
    throw error
  }
  for await (const entry of entries) {
    if (
      (entry.isFile() || entry.isDirectory()) &&
      prefixes.some((prefix) => entry.name.startsWith(prefix)) &&
      TEMPORARY_SUFFIX.test(entry.name)
    ) {
      await rm(path.join(directory, entry.name), {
        force: true,
        recursive: entry.isDirectory()
      })
    }
  }
}
