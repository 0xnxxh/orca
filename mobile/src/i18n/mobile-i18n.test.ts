import { afterEach, describe, expect, it } from 'vitest'
import appConfig from '../../app.json'

import {
  mobileI18n,
  normalizeMobileUiLocale,
  selectPreferredMobileUiLocale,
  shouldReloadForMobileLocaleChange,
  t,
  type MobileUiLocale
} from './mobile-i18n'

const INITIAL_LOCALE = mobileI18n.language

afterEach(async () => {
  await mobileI18n.changeLanguage(INITIAL_LOCALE)
})

describe('mobile i18n', () => {
  it.each([
    ['es-MX', 'es'],
    ['ja-JP', 'ja'],
    ['ko_KR', 'ko'],
    ['zh-Hans-CN', 'zh'],
    ['zh-Hant-TW', 'en'],
    ['zh-MO', 'en'],
    ['fr-FR', 'en']
  ] satisfies [string, MobileUiLocale][])('normalizes %s to %s', (input, expected) => {
    expect(normalizeMobileUiLocale(input)).toBe(expected)
  })

  it('selects the first supported locale from the ordered preferences', () => {
    expect(selectPreferredMobileUiLocale(['fr-FR', 'es-MX'])).toBe('es')
    expect(selectPreferredMobileUiLocale(['zh-Hant', 'ja-JP'])).toBe('ja')
    expect(selectPreferredMobileUiLocale(['zh-MO', 'ko-KR'])).toBe('ko')
  })

  it('reloads only when the effective locale changes', () => {
    expect(shouldReloadForMobileLocaleChange('en', ['fr-FR', 'es-MX'])).toBe(true)
    expect(shouldReloadForMobileLocaleChange('es', ['fr-FR', 'es-MX'])).toBe(false)
  })

  it('reads and interpolates the English catalog', async () => {
    await mobileI18n.changeLanguage('en')
    expect(t('m.rOYT-0U', { value0: 'Camera' })).toBe('Allow Camera?')
  })

  it('enables localized native metadata on iOS', () => {
    expect(appConfig.expo.ios.infoPlist.CFBundleAllowMixedLocalizations).toBe(true)
  })

  it.each([
    ['es', 'Por hacer'],
    ['ja', '未着手'],
    ['ko', '할 일'],
    ['zh', '待办']
  ] satisfies [MobileUiLocale, string][])(
    'uses reviewed task-status copy in %s',
    async (locale, expected) => {
      await mobileI18n.changeLanguage(locale)
      expect(t('m.zWwi3-o')).toBe(expected)
    }
  )

  it('falls back from polluted Simplified Chinese GitLab copy', async () => {
    await mobileI18n.changeLanguage('zh')
    expect([t('m.k98CNAU'), t('m.roI3I5g'), t('m.pmjWIDk')]).toEqual([
      'GitLab Filter',
      'GitLab View',
      'GitLab todo'
    ])
  })

  it('keeps generated terminal shortcut labels canonical in translated locales', async () => {
    await mobileI18n.changeLanguage('zh')
    const {
      buildTerminalShortcutKey,
      TERMINAL_SHORTCUT_MODIFIER_LABELS,
      TERMINAL_SHORTCUT_SPECIAL_KEYS
    } = await import('../terminal/terminal-accessory-keys')

    expect(TERMINAL_SHORTCUT_MODIFIER_LABELS).toEqual({
      ctrl: 'Ctrl',
      alt: 'Alt',
      shift: 'Shift'
    })
    expect(TERMINAL_SHORTCUT_SPECIAL_KEYS.find((key) => key.id === 'pageDown')?.label).toBe('PgDn')
    expect(buildTerminalShortcutKey({ key: 'pageDown', modifiers: ['shift'] })?.label).toBe(
      'Shift+PgDn'
    )
  })

  it.each([
    ['es', ['Sin comprobaciones', 'En staging', 'Nota de revisión']],
    ['ja', ['チェックなし', 'ステージ済み', 'レビューメモ']],
    ['ko', ['체크 없음', '스테이징됨', '리뷰 노트']],
    ['zh', ['没有检查项', '已暂存', '审查备注']]
  ] satisfies [MobileUiLocale, string[]][])(
    'preserves source-control glossary terms in %s',
    async (locale, expected) => {
      await mobileI18n.changeLanguage(locale)
      expect([t('m.hCKjn9A'), t('m.senOKG4'), t('m.2lwuEDc')]).toEqual(expected)
    }
  )
})
