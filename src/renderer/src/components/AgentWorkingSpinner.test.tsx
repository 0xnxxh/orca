import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import React from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import { AgentWorkingSpinner } from './AgentWorkingSpinner'

describe('AgentWorkingSpinner', () => {
  it('hooks the compositor-driven CSS animation, not a JS clock', () => {
    const markup = renderToStaticMarkup(React.createElement(AgentWorkingSpinner))

    expect(markup).toContain('agent-working-spinner')
    expect(markup).toContain('data-agent-spinner')
    expect(markup).toContain('border-yellow-500')
    expect(markup).toContain('border-t-transparent')
    expect(markup).toContain('motion-reduce:border-t-yellow-500')
  })

  // Why: the class only spins if main.css defines it — pin the wiring across
  // both files so neither side can be renamed or dropped alone (STA-3328
  // regressed typing latency when rotation moved onto the input thread).
  it('is backed by a steps(12) keyframe animation in main.css', () => {
    const css = readFileSync(join(__dirname, '../assets/main.css'), 'utf8')

    const rule = css.match(/\.agent-working-spinner\s*\{[^}]*\}/)?.[0]
    expect(rule).toBeDefined()
    expect(rule).toContain('animation: agent-spinner-rotate 1s steps(12, end) infinite')
    expect(css).toContain('@keyframes agent-spinner-rotate')

    const reducedMotionBlock = css.match(
      /@media \(prefers-reduced-motion: reduce\)\s*\{\s*\.agent-working-spinner\s*\{[^}]*\}/
    )?.[0]
    expect(reducedMotionBlock).toContain('animation: none')
  })
})
