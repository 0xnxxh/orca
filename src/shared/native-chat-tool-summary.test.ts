import { describe, expect, it } from 'vitest'
import type { NativeChatBlock } from './native-chat-types'
import {
  briefToolArg,
  describeToolInput,
  formatToolInput,
  isStructuredToolInput,
  summarizeToolInput,
  summarizeToolRun,
  toolFilePath
} from './native-chat-tool-summary'

describe('describeToolInput', () => {
  it('labels a file-target call with its path, not raw JSON', () => {
    expect(describeToolInput({ file_path: '/repo/src/app/Main.tsx', offset: 10 })).toBe(
      '/repo/src/app/Main.tsx'
    )
    expect(describeToolInput({ path: 'src/index.ts' })).toBe('src/index.ts')
    expect(describeToolInput({ file_path: 'C:\\Users\\me\\project\\app.tsx' })).toBe(
      'C:\\Users\\me\\project\\app.tsx'
    )
  })

  it('labels a command-shaped call with its primary argument', () => {
    expect(describeToolInput({ command: 'pnpm test', description: 'Run tests' })).toBe('pnpm test')
    expect(describeToolInput({ pattern: 'foo.*bar', glob: '*.ts' })).toBe('foo.*bar')
    expect(describeToolInput({ url: 'https://example.com', description: 'Fetch it' })).toBe(
      'https://example.com'
    )
    expect(describeToolInput({ description: 'Only prose' })).toBe('Only prose')
  })

  it('falls back to the bounded JSON preview for other shapes', () => {
    expect(describeToolInput({ todos: [{ id: 1 }] })).toBe(
      summarizeToolInput({ todos: [{ id: 1 }] })
    )
    expect(describeToolInput({ command: '   ' })).toBe(summarizeToolInput({ command: '   ' }))
    expect(describeToolInput('raw string input')).toBe('raw string input')
    expect(describeToolInput(null)).toBe('')
  })

  it('truncates an overlong path like any other preview', () => {
    const path = `/very/${'long/'.repeat(30)}file.ts`
    expect(describeToolInput({ file_path: path }).length).toBeLessThanOrEqual(80)
    expect(describeToolInput({ file_path: path })).toContain('…')
  })
})

describe('Codex JSON-string tool arguments', () => {
  it('normalizes them for labels, details, file links and run summaries', () => {
    expect(describeToolInput('{"cmd":"git status --short"}')).toBe('git status --short')
    expect(formatToolInput('{"cmd":"git status --short"}')).toBe(
      '{\n  "cmd": "git status --short"\n}'
    )
    expect(toolFilePath('{"file_path":"src/index.ts"}')).toBe('src/index.ts')
    expect(briefToolArg('{"file_path":"src/app/index.ts"}')).toBe('index.ts')
    expect(briefToolArg('{"cmd":"git status --short"}')).toBe('git status --short')
    expect(isStructuredToolInput('{"cmd":"ls"}')).toBe(true)
  })

  it('joins an argv-array command into one label', () => {
    expect(describeToolInput('{"command":["bash","-lc","make"]}')).toBe('bash -lc make')
    expect(briefToolArg({ command: ['bash', '-lc', 'make'] })).toBe('bash -lc make')
  })

  it('leaves prose and malformed JSON as plain strings', () => {
    expect(describeToolInput('{ not json')).toBe('{ not json')
    expect(formatToolInput('just prose')).toBe('just prose')
    expect(toolFilePath('{"file_path":')).toBeNull()
    expect(isStructuredToolInput('just prose')).toBe(false)
    // A JSON scalar is not an argument object — keep the literal text.
    expect(formatToolInput('"quoted"')).toBe('"quoted"')
  })
})

describe('summarizeToolInput bounded preview', () => {
  it('collapses depth beyond the bound instead of serializing the whole tree', () => {
    const deep = { a: { b: { c: { d: 'buried' } } } }
    const preview = summarizeToolInput(deep)
    expect(preview).toContain('[…]')
    expect(preview).not.toContain('buried')
  })

  it('truncates oversized collections with an ellipsis marker', () => {
    const wide = Object.fromEntries(Array.from({ length: 12 }, (_, i) => [`k${i}`, i]))
    const preview = summarizeToolInput(wide)
    expect(preview).toContain('…')
    expect(preview).not.toContain('k11')
  })

  it('survives circular references', () => {
    const cyclic: Record<string, unknown> = { name: 'loop' }
    cyclic.self = cyclic
    expect(summarizeToolInput(cyclic)).toContain('[circular]')
  })
})

describe('briefToolArg', () => {
  it('extracts the basename from forward- and backslash paths', () => {
    expect(briefToolArg({ file_path: 'src/app/main.tsx' })).toBe('main.tsx')
    expect(briefToolArg({ file_path: 'C:\\Users\\me\\project\\app.tsx' })).toBe('app.tsx')
  })

  it('falls back to the command preview when no path is present', () => {
    expect(briefToolArg({ command: 'git status --short' })).toBe('git status --short')
  })
})

describe('summarizeToolRun', () => {
  it('caps the run summary and skips nameless calls', () => {
    const blocks: NativeChatBlock[] = [
      { type: 'tool-call', name: '  ', input: {} },
      { type: 'tool-call', name: 'Bash', input: { command: 'ls' } },
      { type: 'tool-call', name: 'Read', input: { file_path: 'a.ts' } },
      { type: 'tool-call', name: 'Edit', input: { file_path: 'b.ts' } },
      { type: 'tool-call', name: 'Write', input: { file_path: 'c.ts' } }
    ]
    const summary = summarizeToolRun(blocks)
    expect(summary).toBe('Bash ls  ·  Read a.ts  ·  Edit b.ts')
  })
})
