import { readFileSync, readdirSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { extname, join, relative } from 'node:path'
import { describe, expect, it } from 'vitest'

const appDirectory = fileURLToPath(new URL('../app', import.meta.url))

function sourceFiles(directory: string): string[] {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const path = join(directory, entry.name)
    return entry.isDirectory() ? sourceFiles(path) : [path]
  })
}

describe('Expo route module boundary', () => {
  it('keeps support modules outside the app route directory', () => {
    const invalidRoutes = sourceFiles(appDirectory)
      .filter((path) => ['.ts', '.tsx'].includes(extname(path)))
      .filter((path) => !readFileSync(path, 'utf8').includes('export default'))
      .map((path) => relative(appDirectory, path))

    expect(invalidRoutes).toEqual([])
  })
})
