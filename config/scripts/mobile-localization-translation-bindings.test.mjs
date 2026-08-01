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

  it('tracks translators through object members and destructuring assignments', () => {
    const sourceText = `
import { t } from '@/i18n/mobile-i18n'
const box = { tr: t }
const { tr } = box
let assigned
;({ tr: assigned } = box)
export const labels = [
  box.tr('example.member'),
  tr('example.destructured'),
  assigned('example.assigned')
]
`
    const calls = collectMobileTranslationCalls('/repo/mobile/app/Example.tsx', sourceText, '/repo')

    expect(calls.map((call) => call.keys)).toEqual([
      ['example.member'],
      ['example.destructured'],
      ['example.assigned']
    ])
  })

  it('uses the translator definition that reaches each call', () => {
    const sourceText = `
import { createMobileTranslator, t } from '@/i18n/mobile-i18n'
let replaced = t
replaced = (value) => value
let prefixed = createMobileTranslator('first')
prefixed = createMobileTranslator('second')
export const labels = [replaced('Raw visible copy'), prefixed('title')]
`
    const calls = collectMobileTranslationCalls('/repo/mobile/app/Example.tsx', sourceText, '/repo')

    expect(calls.map((call) => call.keys)).toEqual([['second.title']])
  })

  it('resolves long reverse alias chains without whole-file fixed-point rescans', () => {
    const aliases = Array.from({ length: 1500 }, (_, index) =>
      index === 1499 ? `const alias${index} = t` : `const alias${index} = alias${index + 1}`
    ).join('\n')
    const sourceText = `
import { t } from '@/i18n/mobile-i18n'
${aliases}
export const label = alias0('example.scaled')
`
    const startedAt = performance.now()
    const calls = collectMobileTranslationCalls('/repo/mobile/app/Example.tsx', sourceText, '/repo')

    expect(calls.map((call) => call.keys)).toEqual([['example.scaled']])
    expect(performance.now() - startedAt).toBeLessThan(1000)
  })
})
