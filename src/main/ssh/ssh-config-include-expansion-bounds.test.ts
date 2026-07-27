import { mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  appendSshConfigExpandedLine,
  createSshConfigExpansionBudget,
  readSshConfigSourceFile,
  SSH_CONFIG_INCLUDE_LIMITS
} from './ssh-config-expansion-budget'
import { expandSshConfigIncludes } from './ssh-config-include-expander'

const tempRoots: string[] = []

function makeTempRoot(): string {
  const root = mkdtempSync(join(tmpdir(), 'orca-ssh-config-bounds-'))
  tempRoots.push(root)
  return root
}

afterEach(() => {
  vi.restoreAllMocks()
  for (const root of tempRoots.splice(0)) {
    rmSync(root, { recursive: true, force: true })
  }
})

describe('SSH config include expansion bounds', () => {
  it('stops recursive includes at 16 active files', () => {
    vi.spyOn(console, 'warn').mockImplementation(() => {})
    const root = makeTempRoot()
    for (let depth = 0; depth < 20; depth += 1) {
      writeFileSync(
        join(root, `${depth}.conf`),
        `Host depth-${depth}\n${depth < 19 ? `Include ${depth + 1}.conf\n` : ''}`
      )
    }

    const expanded = expandSshConfigIncludes(join(root, '0.conf'))

    expect(expanded).toContain('Host depth-15')
    expect(expanded).not.toContain('Host depth-16')
    expect(console.warn).toHaveBeenCalledWith(expect.stringContaining('nesting exceeds 16'))
  })

  it('admits exactly 1,024 unique files and 16 MiB of source bytes', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const root = makeTempRoot()
    const firstPath = join(root, 'first.conf')
    const secondPath = join(root, 'second.conf')
    writeFileSync(firstPath, 'a')
    writeFileSync(secondPath, 'b')
    const fileBudget = createSshConfigExpansionBudget()
    fileBudget.fileCount = SSH_CONFIG_INCLUDE_LIMITS.files - 1

    expect(readSshConfigSourceFile(firstPath, fileBudget)).toBe('a')
    expect(readSshConfigSourceFile(secondPath, fileBudget)).toBeNull()

    const byteBudget = createSshConfigExpansionBudget()
    byteBudget.sourceBytes = SSH_CONFIG_INCLUDE_LIMITS.sourceBytes - 1
    expect(readSshConfigSourceFile(firstPath, byteBudget)).toBe('a')
    expect(readSshConfigSourceFile(secondPath, byteBudget)).toBeNull()
    expect(warn).toHaveBeenCalledWith(expect.stringContaining('file count exceeds 1024'))
    expect(warn).toHaveBeenCalledWith(expect.stringContaining('sources exceed 16777216 bytes'))
  })

  it('admits the last line at the output ceiling and truncates the next', () => {
    vi.spyOn(console, 'warn').mockImplementation(() => {})
    const byteBudget = createSshConfigExpansionBudget()
    byteBudget.expandedBytes = SSH_CONFIG_INCLUDE_LIMITS.expandedBytes - 1
    const byteLines = ['']
    appendSshConfigExpandedLine(byteLines, '', byteBudget)
    expect(byteBudget.expandedBytes).toBe(SSH_CONFIG_INCLUDE_LIMITS.expandedBytes)
    appendSshConfigExpandedLine(byteLines, '', byteBudget)
    expect(byteBudget.outputTruncated).toBe(true)

    const lineBudget = createSshConfigExpansionBudget()
    lineBudget.expandedLines = SSH_CONFIG_INCLUDE_LIMITS.expandedLines
    appendSshConfigExpandedLine([], 'Host overflow', lineBudget)
    expect(lineBudget.outputTruncated).toBe(true)
  })

  it('holds expanded output under 16 MiB when a small config amplifies through repeated includes', () => {
    // Why: the same file may be included many times — only *active* recursion is blocked — so a
    // megabyte of source that passes every read limit can still expand into tens of megabytes.
    // Asserted against the literal ceiling, not the constant, so raising the constant fails here.
    vi.spyOn(console, 'warn').mockImplementation(() => {})
    const root = makeTempRoot()
    const childLine = `# ${'x'.repeat(997)}`
    writeFileSync(
      join(root, 'child.conf'),
      `${Array.from({ length: 1_048 }, () => childLine).join('\n')}\n`
    )
    writeFileSync(
      join(root, 'root.conf'),
      Array.from({ length: 18 }, () => 'Include child.conf').join('\n')
    )

    const expandedBytes = Buffer.byteLength(
      expandSshConfigIncludes(join(root, 'root.conf')),
      'utf8'
    )

    // Unbounded expansion here is ~18 MiB; the line ceiling is nowhere near reached at ~19k lines.
    expect(expandedBytes).toBeLessThanOrEqual(16 * 1024 * 1024)
    expect(expandedBytes).toBeGreaterThan(15 * 1024 * 1024)
  })

  it('rejects an include whose decoded size exceeds the per-file ceiling', () => {
    // Why: the pre-read stat check sees bytes on disk, but invalid UTF-8 decodes to U+FFFD at 3
    // bytes out per byte in. A 400 KiB binary passes the stat check and lands as 1.2 MB of text.
    vi.spyOn(console, 'warn').mockImplementation(() => {})
    const root = makeTempRoot()
    const filePath = join(root, 'binary.conf')
    writeFileSync(filePath, Buffer.alloc(400 * 1024, 0xff))

    const onDiskBytes = statSync(filePath).size
    expect(onDiskBytes).toBeLessThan(SSH_CONFIG_INCLUDE_LIMITS.fileBytes)
    const decodedBytes = Buffer.byteLength(readFileSync(filePath).toString('utf-8'), 'utf8')
    expect(decodedBytes).toBeGreaterThan(SSH_CONFIG_INCLUDE_LIMITS.fileBytes)

    const budget = createSshConfigExpansionBudget()
    expect(readSshConfigSourceFile(filePath, budget)).toBeNull()
    expect(budget.sourceBytes).toBe(0)
  })

  it('stops reading source files once expanded output is truncated', () => {
    // Why: with output discarded, continuing the walk still pulls every remaining include into the
    // source cache. The stop has to happen at the walk, not just at the append.
    vi.spyOn(console, 'warn').mockImplementation(() => {})
    const root = makeTempRoot()
    const bulkLine = `# ${'x'.repeat(997)}`
    const bulk = `${Array.from({ length: 1_048 }, () => bulkLine).join('\n')}\n`
    writeFileSync(join(root, 'bulk.conf'), bulk)
    // Distinct files, so reading them consumes the 16 MiB source budget rather than hitting cache.
    for (let index = 0; index < 20; index += 1) {
      writeFileSync(join(root, `filler-${index}.conf`), bulk)
    }
    writeFileSync(
      join(root, 'root.conf'),
      [
        // Re-including one file 20× overflows expanded output while costing 1 MiB of source.
        ...Array.from({ length: 20 }, () => 'Include bulk.conf'),
        ...Array.from({ length: 20 }, (_unused, index) => `Include filler-${index}.conf`)
      ].join('\n')
    )

    expandSshConfigIncludes(join(root, 'root.conf'))

    // The fillers total ~21 MiB; reading any meaningful share of them trips the source ceiling.
    expect(console.warn).not.toHaveBeenCalledWith(expect.stringContaining('sources exceed'))
  })

  it('holds expanded output to 200,000 lines when a small config carries a million of them', () => {
    // Why: a 1 MB file of bare newlines is a legal include under every byte limit and still
    // carries a million lines. Asserted against the literal ceiling for the same reason as above.
    vi.spyOn(console, 'warn').mockImplementation(() => {})
    const root = makeTempRoot()
    writeFileSync(join(root, 'root.conf'), '\n'.repeat(1_000_000))

    const expanded = expandSshConfigIncludes(join(root, 'root.conf'))

    expect(expanded.split('\n')).toHaveLength(200_000)
  })
})
