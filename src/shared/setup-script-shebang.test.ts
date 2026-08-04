import { describe, it, expect } from 'vitest'
import { isShebangLine, scriptDeclaresPosixShell } from './setup-script-shebang'

describe('scriptDeclaresPosixShell', () => {
  it('accepts the common env and absolute-path forms', () => {
    expect(scriptDeclaresPosixShell('#!/usr/bin/env bash\npnpm install')).toBe(true)
    expect(scriptDeclaresPosixShell('#!/bin/sh -e\npnpm install')).toBe(true)
    expect(scriptDeclaresPosixShell('#!/usr/bin/env -S bash -euo pipefail\npnpm install')).toBe(
      true
    )
    expect(scriptDeclaresPosixShell('#!/bin/zsh')).toBe(true)
  })

  it('rejects scripts with no interpreter line', () => {
    // Regression: batch-syntax setup scripts must stay on the cmd runner.
    expect(scriptDeclaresPosixShell('copy .env.example .env\nxcopy /E assets dist')).toBe(false)
    expect(scriptDeclaresPosixShell('')).toBe(false)
    expect(scriptDeclaresPosixShell('pnpm install\n#!/usr/bin/env bash')).toBe(false)
    expect(scriptDeclaresPosixShell('# !/usr/bin/env bash\npnpm install')).toBe(false)
  })

  it('rejects interpreters that are not POSIX shells', () => {
    expect(scriptDeclaresPosixShell('#!/usr/bin/env node\nconsole.log(1)')).toBe(false)
    expect(scriptDeclaresPosixShell('#!/usr/bin/env python3\nprint(1)')).toBe(false)
  })

  it('tolerates CRLF and Windows-style interpreter paths', () => {
    expect(scriptDeclaresPosixShell('#!/usr/bin/env bash\r\npnpm install')).toBe(true)
    expect(scriptDeclaresPosixShell('#!C:\\tools\\git\\bin\\bash.exe\r\npnpm install')).toBe(true)
  })
})

describe('isShebangLine', () => {
  it('detects interpreter lines regardless of leading whitespace', () => {
    expect(isShebangLine('#!/usr/bin/env bash')).toBe(true)
    expect(isShebangLine('  #!/bin/sh')).toBe(true)
    expect(isShebangLine('#comment')).toBe(false)
    expect(isShebangLine('pnpm install')).toBe(false)
  })
})
