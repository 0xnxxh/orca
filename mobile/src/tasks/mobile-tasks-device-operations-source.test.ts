import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

const tasksRouteSource = readFileSync(
  new URL('../../app/h/[hostId]/tasks.tsx', import.meta.url),
  'utf8'
)
const copyFeedbackSource = readFileSync(
  new URL('./use-mobile-task-copy-feedback.ts', import.meta.url),
  'utf8'
)

describe('mobile tasks device operations', () => {
  it('keeps the existing presentation behind an injectable native boundary', () => {
    expect(tasksRouteSource).toContain('export default function MobileTasksScreen({')
    expect(tasksRouteSource).toContain('deviceOperations = defaultHostTaskDeviceOperations()')
    expect(tasksRouteSource).toContain('useMobileTaskCopyFeedback({')
    expect(copyFeedbackSource).toContain('operations.copyText(')
    expect(tasksRouteSource).toContain('deviceOperations.hapticMediumImpact()')
    expect(tasksRouteSource).toContain('deviceOperations.openExternalUrl(')
    expect(tasksRouteSource).not.toContain("from 'expo-clipboard'")
    expect(tasksRouteSource).not.toContain('Linking.openURL')
    expect(tasksRouteSource).not.toContain("from '../../../src/platform/haptics'")
  })
})
