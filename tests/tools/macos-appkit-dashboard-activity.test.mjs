import { describe, expect, it } from 'vitest'
import {
  APPKIT_REPRO_TERMINAL_COUNT,
  buildDashboardActivityScript
} from './macos-appkit-dashboard-activity.mjs'

describe('macOS AppKit dashboard activity fixture', () => {
  it('matches the incident terminal and dashboard churn without changing window geometry', () => {
    const script = buildDashboardActivityScript()

    expect(APPKIT_REPRO_TERMINAL_COUNT).toBe(14)
    expect(() => new Function(`return ${script}`)).not.toThrow()
    expect(script).toContain('createTab')
    expect(script).toContain('window.api.pty.write')
    expect(script).toContain('window.api.dashboard.publishSnapshot')
    expect(script).toContain('setActiveTab')
    expect(script).not.toMatch(/\b(?:resizeTo|resizeBy|moveTo|moveBy)\b/)
    expect(script).not.toMatch(/\.(?:minimize|maximize|restore|setBounds|setSize|setPosition)\b/)
  })
})
