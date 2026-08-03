import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

// Why (#11161): the whole fix is that no port-scan spawn runs on the main
// process' event loop. That is a property of the import graph, so assert it
// directly — a future edit that reaches for execFile here would silently
// restore the UI freeze without failing any behavioural test.

const CHILD_PROCESS_IMPORT =
  /from\s+['"](node:)?child_process['"]|require\(\s*['"](node:)?child_process['"]/
const ELECTRON_IMPORT = /from\s+['"]electron['"]|require\(\s*['"]electron['"]/

// Comments in these files legitimately name the modules they must not import,
// so strip comments before matching.
function sourceOf(fileName: string): string {
  return readFileSync(join(__dirname, fileName), 'utf-8')
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/^\s*\/\/.*$/gm, '')
}

describe('port scan main-thread spawn boundary', () => {
  it('keeps local-workspace-port-scanner.ts free of child_process', () => {
    expect(CHILD_PROCESS_IMPORT.test(sourceOf('local-workspace-port-scanner.ts'))).toBe(false)
  })

  it('keeps port-scan-command-client.ts free of child_process', () => {
    expect(CHILD_PROCESS_IMPORT.test(sourceOf('port-scan-command-client.ts'))).toBe(false)
  })

  it('keeps the worker entry free of electron', () => {
    expect(ELECTRON_IMPORT.test(sourceOf('port-scan-command-worker-entry.ts'))).toBe(false)
    expect(ELECTRON_IMPORT.test(sourceOf('port-scan-command-execution.ts'))).toBe(false)
  })
})
