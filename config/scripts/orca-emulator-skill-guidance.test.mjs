import { readFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import { BUNDLED_SKILL_GUIDES } from '../../src/cli/bundled-skill-guides'

const projectDir = resolve(import.meta.dirname, '../..')
const guidePath = join(projectDir, 'skill-guides', 'orca-emulator.md')
const stubPath = join(projectDir, 'skills', 'orca-emulator', 'SKILL.md')
const bundledGuide = BUNDLED_SKILL_GUIDES.find((guide) => guide.name === 'orca-emulator')?.markdown

describe('orca emulator skill guidance', () => {
  it('keeps native screenshot evidence in the source and generated guide', () => {
    expect(bundledGuide).toBeDefined()

    for (const source of [readFileSync(guidePath, 'utf8'), bundledGuide]) {
      const skill = source.replace(/\s+/gu, ' ')

      expect(skill).toContain('Drive and verify the exact native app state')
      expect(skill).toContain('ORCA computer capabilities --json')
      expect(skill).toContain(
        'ORCA computer get-app-state --app com.apple.iphonesimulator --restore-window --json'
      )
      expect(skill).toContain('`result.screenshot.path`')
      expect(skill).toContain('inspect the image visually')
      expect(skill).toContain('exclude secrets and pairing codes')
      expect(skill).toContain('ORCA computer list-windows --app com.apple.iphonesimulator --json')
      expect(skill).toContain('`--window-id <id>`')
      expect(skill).toContain('`--window-index <n>`')
      expect(skill).toContain('gh image')
      expect(skill).toContain('gh attach')
      expect(skill).toContain('without adding the PNG to Git')
      expect(skill).toContain('never substitutes an Electron or Expo Web render')
      expect(skill).toContain('never bypasses Orca emulator lifecycle or control')
      expect(skill).toContain('report native QA as blocked')
    }
  })

  it('keeps lifecycle and native-only constraints discoverable from the stub', () => {
    const stub = readFileSync(stubPath, 'utf8').replace(/\s+/gu, ' ')

    expect(stub).toContain('Keep Orca emulator as the lifecycle and interaction control surface')
    expect(stub).toContain('capture the desktop Simulator window')
    expect(stub).toContain('Never substitute Electron or Expo Web evidence')
    expect(stub).toContain('Raw `serve-sim` and direct `simctl` are unnecessary')
  })
})
