import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

const shellSource = readFileSync(
  new URL('./MobileWebHybridShellPresentation.tsx', import.meta.url),
  'utf8'
)
const hostPickerSource = readFileSync(new URL('./MobileWebHostPicker.tsx', import.meta.url), 'utf8')
const recoveryActionsSource = readFileSync(
  new URL('./MobileWebRecoveryActions.tsx', import.meta.url),
  'utf8'
)

describe('mobile web shell accessibility', () => {
  it('keeps shell navigation controls named and exposed as buttons', () => {
    expect(shellSource).toMatch(
      /accessibilityLabel="Back"\s+accessibilityRole="button"[\s\S]*?onPress=\{onBack\}/
    )
    expect(shellSource).toMatch(
      /accessibilityLabel="Show paired hosts"\s+accessibilityRole="button"[\s\S]*?>\s+<Text[^>]*>Hosts/
    )
  })

  it('announces package loading and warnings', () => {
    expect(shellSource).toMatch(
      /accessibilityLiveRegion="polite"[\s\S]*?Preparing verified interface…/
    )
    expect(shellSource.match(/accessibilityRole="alert"/g)).toHaveLength(2)
  })

  it('names host selection and recovery controls', () => {
    expect(hostPickerSource).toContain('accessibilityLabel="Retry loading paired hosts"')
    expect(hostPickerSource).toContain('accessibilityLabel={`Open ${host.name}`}')
    expect(hostPickerSource.match(/accessibilityRole="button"/g)).toHaveLength(2)
    expect(hostPickerSource).toContain('accessibilityLiveRegion="polite"')
    expect(hostPickerSource).toContain(
      "accessibilityRole={presentationState === 'failed' ? 'alert' : undefined}"
    )
    expect(recoveryActionsSource).toContain('accessibilityRole="toolbar"')
    expect(recoveryActionsSource).toContain(
      'accessibilityLabel={`${action.label} workspace interface`}'
    )
    expect(recoveryActionsSource).toContain("label: 'Retry'")
    expect(recoveryActionsSource).toContain("label: 'Use previous'")
    expect(recoveryActionsSource).toContain("label: 'Clear cache'")
    expect(recoveryActionsSource).toContain("label: 'Switch hosts'")
    expect(recoveryActionsSource).toContain(
      'accessibilityState={{ disabled: Boolean(busyAction) }}'
    )
  })
})
