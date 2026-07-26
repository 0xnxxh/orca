import { readFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

// Why: the inner-binary signing gate silently degraded for four releases because it
// shelled out to a hardcoded `node_modules/7zip-bin/...` path that electron-builder
// 26.9+ no longer installs. Pin both workflows to the resolver instead (#6487).

const workflowsDir = resolve(import.meta.dirname, '../..', '.github', 'workflows')

const GATED_WORKFLOWS = ['release-cut.yml', 'windows-signing-rehearsal.yml']

function workflowSource(name) {
  return readFileSync(join(workflowsDir, name), 'utf8')
}

// Why a scanner and not a regex: PowerShell here-docs in these gates contain
// braces inside strings (`"{0,-14} {1}  <{2}>" -f ...`) and inside comments, so
// naive brace counting mis-pairs and every scope assertion below silently
// degrades into "some text appears somewhere in the file".
function findBlockEnd(source, openIndex) {
  let depth = 0
  let i = openIndex
  while (i < source.length) {
    const char = source[i]
    if (char === '#') {
      const newline = source.indexOf('\n', i)
      i = newline === -1 ? source.length : newline
      continue
    }
    if (char === "'") {
      const end = source.indexOf("'", i + 1)
      i = end === -1 ? source.length : end + 1
      continue
    }
    if (char === '"') {
      i += 1
      while (i < source.length && source[i] !== '"') {
        i += source[i] === '`' ? 2 : 1
      }
      i += 1
      continue
    }
    if (char === '{') {
      depth += 1
    } else if (char === '}') {
      depth -= 1
      if (depth === 0) {
        return i
      }
    }
    i += 1
  }
  throw new Error(`unbalanced block starting at ${openIndex}`)
}

/** The `{ ... }` block that opens after `marker`, as `{ start, end, body }`. */
function blockAfter(source, marker, from = 0) {
  const markerIndex = source.indexOf(marker, from)
  expect(markerIndex, `missing marker: ${marker}`).toBeGreaterThan(-1)
  const start = source.indexOf('{', markerIndex)
  expect(start, `no block opens after: ${marker}`).toBeGreaterThan(-1)
  const end = findBlockEnd(source, start)
  return { start, end, body: source.slice(start, end + 1) }
}

describe('Windows signing gates resolve 7za through the toolset resolver (#6487)', () => {
  for (const name of GATED_WORKFLOWS) {
    it(`${name} does not hardcode the removed 7zip-bin path`, () => {
      expect(workflowSource(name)).not.toContain('node_modules/7zip-bin')
    })

    it(`${name} resolves 7za via resolve-7za-path.mjs`, () => {
      expect(workflowSource(name)).toContain('node config/scripts/resolve-7za-path.mjs')
    })

    // Why scope-checked: downgrading this `throw` to a `Write-Host` warning
    // restores the original silent fail-open — the gate extracts nothing, finds
    // no files, and reports success. A `toContain` on the guard condition alone
    // does not notice.
    it(`${name} aborts the gate when 7za cannot be resolved`, () => {
      const source = workflowSource(name)
      const guard = blockAfter(source, '$LASTEXITCODE -ne 0 -or -not (Test-Path $7za)')
      expect(guard.body).toMatch(/\bthrow\b/)
    })
  }

  // Why sliced to one step: release-cut.yml runs several PowerShell gates that
  // share idioms (`$failures`, `} catch {`), so a whole-file search silently
  // asserts against the wrong block.
  function innerBinaryStep() {
    const source = workflowSource('release-cut.yml')
    const start = source.indexOf('- name: Verify Windows inner binary signatures')
    expect(start).toBeGreaterThan(-1)
    const end = source.indexOf('\n      - name:', start + 1)
    expect(end).toBeGreaterThan(start)
    return source.slice(start, end)
  }

  // Why parse the function body rather than grep the file: asserting that the
  // string 'Write-GateVerdict' appears somewhere passes even if the body is
  // gutted to a Write-Host, which is exactly the silent degradation this gate
  // exists to prevent.
  function gateVerdictFunctionBody() {
    return blockAfter(innerBinaryStep(), 'function Write-GateVerdict').body
  }

  it('persists the verdict to the evidence file the artifact upload collects', () => {
    const body = gateVerdictFunctionBody()
    expect(body).toMatch(/Set-Content\s+-Path\s+'inner-signing-evidence\.txt'/)
    expect(body).toContain('Add-GateSummary')
  })

  it('never lets verdict persistence itself fail a warn-only release', () => {
    // Every persistence helper is best-effort: a disk-full or read-only runner
    // must not turn evidence-writing into the thing that fails the release.
    const step = innerBinaryStep()
    for (const helper of ['function Add-GateEvidence', 'function Add-GateSummary']) {
      const body = blockAfter(step, helper).body
      expect(body, helper).toContain('-ErrorAction Stop')
      expect(body, helper).toMatch(/\bcatch\b/)
    }
    expect(gateVerdictFunctionBody()).toMatch(/\bcatch\b/)
  })

  it('records a verdict on every terminal branch of the gate', () => {
    const step = innerBinaryStep()
    for (const verdict of ['NOT VERIFIED', 'ERRORED', 'VERDICT: FAILED', 'VERDICT: PASSED']) {
      expect(step).toContain(verdict)
    }
  })

  it('throws a required-mode signature failure outside the catch that would mask it', () => {
    // Why: throwing inside `try` re-enters the catch, whose Set-Content
    // replaces the per-file report with "ERRORED — <exception>".
    const step = innerBinaryStep()
    const policyThrow = step.indexOf('if ($policyFailure) { throw $policyFailure }')
    expect(policyThrow).toBeGreaterThan(-1)
    const catchBlock = blockAfter(step, '} catch {')
    expect(policyThrow).toBeGreaterThan(catchBlock.end)
  })

  // Why: the assignment is what survives a write failure. With it after the
  // evidence/summary writes, a throwing Add-Content lands in the catch with
  // $policyFailure still null — required mode reports ERRORED and overwrites the
  // per-file report, reintroducing exactly the loss the hoist prevents.
  it('records the required-mode failure before attempting any evidence write', () => {
    const branch = blockAfter(innerBinaryStep(), 'if ($failures.Count -gt 0)').body
    const assignment = branch.indexOf('$policyFailure = $message')
    expect(assignment).toBeGreaterThan(-1)
    for (const write of ['Add-GateEvidence', 'Add-GateSummary']) {
      expect(branch.indexOf(write), write).toBeGreaterThan(assignment)
    }
  })
})
