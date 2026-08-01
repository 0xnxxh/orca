import { describe, expect, it } from 'vitest'

import { collectMobileTranslationCalls } from './verify-mobile-localization-catalog.mjs'

describe('mobile-localization-translation-bindings', () => {
  it('finds forward and assignment translator aliases to a fixed point', () => {
    const sourceText = `
import { createMobileTranslator, t } from '@/i18n/mobile-i18n'
import * as i18n from '@/i18n/mobile-i18n'
export function forwardLabel() {
  const tr = laterAlias
  return tr('example.forward')
}
const laterAlias = t
let assigned
assigned = t
let destructured
;({ t: destructured } = i18n)
let prefixed
prefixed = createMobileTranslator('example')
export const labels = [
  assigned('example.assigned'),
  destructured('example.destructured'),
  prefixed('prefixed')
]
`
    const calls = collectMobileTranslationCalls('/repo/mobile/app/Example.tsx', sourceText, '/repo')

    expect(calls.map((call) => call.keys)).toEqual([
      ['example.forward'],
      ['example.assigned'],
      ['example.destructured'],
      ['example.prefixed']
    ])
  })

  it('keeps namespace var translators inside their module scope', () => {
    const sourceText = `
import { t } from '@/i18n/mobile-i18n'
namespace Local {
  var t = (value) => value
  export const raw = t('not-a-translation-key')
}
export const translated = t('example.translated')
`
    const calls = collectMobileTranslationCalls('/repo/mobile/app/Example.tsx', sourceText, '/repo')

    expect(calls.map((call) => call.keys)).toEqual([['example.translated']])
  })
})
