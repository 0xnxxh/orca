import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'

import { describe, expect, it, vi } from 'vitest'

import {
  collectMobileTranslationCalls,
  main as verifyMobileCatalog
} from './verify-mobile-localization-catalog.mjs'

const LOCALES = ['en', 'es', 'ja', 'ko', 'zh']
const NATIVE_LOCALES = ['en', 'es', 'ja', 'ko', 'zh-Hans']
const NATIVE_CATALOG = {
  ios: {
    CFBundleDisplayName: 'Orca',
    NSCameraUsageDescription: 'Camera fallback',
    NSLocalNetworkUsageDescription: 'Network fallback',
    NSMicrophoneUsageDescription: 'Microphone fallback',
    NSPhotoLibraryUsageDescription: 'Photo fallback'
  },
  android: { app_name: 'Orca' }
}

function defaultAppConfig() {
  return {
    expo: {
      name: 'Orca',
      locales: Object.fromEntries(
        NATIVE_LOCALES.map((locale) => [locale, `./locales/${locale}.json`])
      ),
      ios: {
        infoPlist: {
          NSLocalNetworkUsageDescription: 'Network fallback',
          NSMicrophoneUsageDescription: 'Microphone fallback',
          NSPhotoLibraryUsageDescription: 'Photo fallback'
        }
      },
      plugins: [
        ['expo-localization', { supportedLocales: NATIVE_LOCALES }],
        [
          'expo-camera',
          { cameraPermission: 'Camera fallback', microphonePermission: 'Microphone fallback' }
        ],
        ['expo-image-picker', { photosPermission: 'Photo fallback' }]
      ]
    }
  }
}

function writeJson(filePath, value) {
  writeFileSync(filePath, `${JSON.stringify(value, null, 2)}\n`, 'utf8')
}

function makeProject({
  sourceText,
  sourceFileName = 'Example.tsx',
  catalogs,
  nativeCatalogs,
  appConfig
}) {
  const root = mkdtempSync(path.join(tmpdir(), 'orca-mobile-localization-'))
  const appDirectory = path.join(root, 'mobile', 'app')
  const sourceDirectory = path.join(root, 'mobile', 'src')
  const localeDirectory = path.join(sourceDirectory, 'i18n', 'locales')
  const nativeLocaleDirectory = path.join(root, 'mobile', 'locales')
  mkdirSync(appDirectory, { recursive: true })
  mkdirSync(localeDirectory, { recursive: true })
  mkdirSync(nativeLocaleDirectory, { recursive: true })
  writeFileSync(path.join(appDirectory, sourceFileName), sourceText, 'utf8')
  writeJson(path.join(root, 'mobile', 'app.json'), appConfig ?? defaultAppConfig())

  for (const locale of LOCALES) {
    writeJson(
      path.join(localeDirectory, `${locale}.json`),
      catalogs?.[locale] ?? (locale === 'en' ? catalogs.en : {})
    )
  }
  for (const locale of NATIVE_LOCALES) {
    writeJson(
      path.join(nativeLocaleDirectory, `${locale}.json`),
      nativeCatalogs?.[locale] ?? NATIVE_CATALOG
    )
  }
  return root
}

async function runFailedVerification(root) {
  const error = vi.spyOn(console, 'error').mockImplementation(() => undefined)
  try {
    await expect(verifyMobileCatalog(root)).resolves.toBe(1)
    return error.mock.calls.flat().join('\n')
  } finally {
    error.mockRestore()
  }
}

describe('verify-mobile-localization-catalog', () => {
  it('verifies literal and conditional keys with matching options', async () => {
    const catalog = { example: { greeting: 'Hello {{name}}', farewell: 'Bye {{name}}' } }
    const root = makeProject({
      sourceText:
        "import { t } from '@/i18n/mobile-i18n'\nconst name = 'Orca'\nexport const label = t(name ? 'example.greeting' : 'example.farewell', { name })\n",
      catalogs: { en: catalog }
    })

    await expect(verifyMobileCatalog(root)).resolves.toBe(0)
  })

  it('reports missing keys in conditional branches', async () => {
    const root = makeProject({
      sourceText:
        "import { t } from '@/i18n/mobile-i18n'\nexport const label = t(flag ? 'm.known' : 'm.missing')\n",
      catalogs: { en: { m: { known: 'Known' } } }
    })

    expect(await runFailedVerification(root)).toContain('missing English key: m.missing')
  })

  it('reports missing keys used by an English fixed translator', async () => {
    const root = makeProject({
      sourceText:
        "import { mobileI18n } from '@/i18n/mobile-i18n'\nconst canonicalLabel = mobileI18n.getFixedT('en')\nexport const label = canonicalLabel('m.missing')\n",
      catalogs: { en: { m: { known: 'Known' } } }
    })

    expect(await runFailedVerification(root)).toContain('missing English key: m.missing')
  })

  it('tracks aliased imports without treating shadowed names as translators', async () => {
    const sourceText = `
import { t as translateMobile } from '@/i18n/mobile-i18n'
export const label = translateMobile('example.known')
export function local(translateMobile) {
  return translateMobile('not-a-translation-key')
}
`
    const calls = collectMobileTranslationCalls('/repo/mobile/app/Example.tsx', sourceText, '/repo')

    expect(calls.map((call) => call.keys)).toEqual([['example.known']])
  })

  it('expands statically prefixed translators without accepting shadowed calls', () => {
    const sourceText = `
import { createMobileTranslator as makeTranslator } from '@/i18n/mobile-i18n'
const translate = makeTranslator('example')
export const label = translate('known')
export function local(translate) {
  return translate('not-a-translation-key')
}
`
    const calls = collectMobileTranslationCalls('/repo/mobile/app/Example.tsx', sourceText, '/repo')

    expect(calls.map((call) => call.keys)).toEqual([['example.known']])
  })

  it('tracks function-local prefixed and fixed translators by binding', () => {
    const sourceText = `
import { createMobileTranslator, mobileI18n } from '@/i18n/mobile-i18n'
export function labels() {
  const tr = createMobileTranslator('example')
  const fixed = mobileI18n.getFixedT('en')
  return [tr('known'), fixed('example.fixed')]
}
`
    const calls = collectMobileTranslationCalls('/repo/mobile/app/Example.tsx', sourceText, '/repo')

    expect(calls.map((call) => call.keys)).toEqual([['example.known'], ['example.fixed']])
  })

  it('tracks direct translator factories and ordinary local aliases', () => {
    const sourceText = `
import { createMobileTranslator, t } from '@/i18n/mobile-i18n'
const direct = t
const prefixed = createMobileTranslator('example')
const prefixedAlias = prefixed
const factory = createMobileTranslator
export const labels = [
  direct('example.direct'),
  createMobileTranslator('example')('inline'),
  prefixedAlias('aliased'),
  factory('example')('factoryAlias')
]
`
    const calls = collectMobileTranslationCalls('/repo/mobile/app/Example.tsx', sourceText, '/repo')

    expect(calls.map((call) => call.keys)).toEqual([
      ['example.direct'],
      ['example.inline'],
      ['example.aliased'],
      ['example.factoryAlias']
    ])
  })

  it('tracks instance and namespace translation calls', () => {
    const sourceText = `
import { mobileI18n } from '@/i18n/mobile-i18n'
import * as i18n from '@/i18n/mobile-i18n'
const tr = i18n.createMobileTranslator('example')
export const labels = [
  mobileI18n.t('example.instance'),
  i18n.t('example.namespace'),
  i18n.mobileI18n.t('example.namespaceInstance'),
  tr('prefixed')
]
`
    const calls = collectMobileTranslationCalls('/repo/mobile/app/Example.tsx', sourceText, '/repo')

    expect(calls.map((call) => call.keys)).toEqual([
      ['example.instance'],
      ['example.namespace'],
      ['example.namespaceInstance'],
      ['example.prefixed']
    ])
  })

  it('limits for-loop and catch bindings to their lexical scopes', () => {
    const sourceText = `
import { t } from '@/i18n/mobile-i18n'
for (const t of callbacks) t('local-loop-call')
export const afterLoop = t('example.afterLoop')
try { run() } catch (t) { t('local-catch-call') }
export const afterCatch = t('example.afterCatch')
`
    const calls = collectMobileTranslationCalls('/repo/mobile/app/Example.tsx', sourceText, '/repo')

    expect(calls.map((call) => call.keys)).toEqual([['example.afterLoop'], ['example.afterCatch']])
  })

  it('ignores unrelated local t functions', () => {
    const calls = collectMobileTranslationCalls(
      '/repo/mobile/app/Example.tsx',
      "function t(value) { return value }\nexport const label = t('not-a-translation-key')\n",
      '/repo'
    )

    expect(calls).toEqual([])
  })

  it('rejects translation keys that cannot be statically inspected', async () => {
    const root = makeProject({
      sourceText: "import { t } from '@/i18n/mobile-i18n'\nexport const label = t(runtimeKey)\n",
      catalogs: { en: { m: { known: 'Known' } } }
    })

    expect(await runFailedVerification(root)).toContain('not statically inspectable')
  })

  it('requires call options to exactly match English placeholders', async () => {
    const root = makeProject({
      sourceText:
        "import { t } from '@/i18n/mobile-i18n'\nexport const label = t('m.greeting', { value: 'Orca' })\n",
      catalogs: { en: { m: { greeting: 'Hello {{name}}' } } }
    })

    const report = await runFailedVerification(root)
    expect(report).toContain('options [value]')
    expect(report).toContain('placeholders [name]')
  })

  it('allows missing translations in sparse locale catalogs', async () => {
    const en = { example: { greeting: 'Hello {{name}}' } }
    const root = makeProject({
      sourceText:
        "import { t } from '@/i18n/mobile-i18n'\nexport const label = t('example.greeting', { name: 'Orca' })\n",
      catalogs: {
        en,
        es: { example: { greeting: 'Hola {{name}}' } }
      }
    })

    await expect(verifyMobileCatalog(root)).resolves.toBe(0)
  })

  it('rejects opaque IDs, positional placeholders, and orphaned English keys', async () => {
    const root = makeProject({
      sourceText:
        "import { t } from '@/i18n/mobile-i18n'\nexport const label = t('m.opaque', { value0: 'Orca' })\n",
      catalogs: { en: { m: { opaque: 'Hello {{value0}}', orphan: 'Unused' } } }
    })

    const report = await runFailedVerification(root)
    expect(report).toContain('message ID must be intent-named: m.opaque')
    expect(report).toContain('placeholder must be intent-named: m.opaque uses value0')
    expect(report).toContain('en.json has orphaned key: m.orphan')
  })

  it('rejects copied English target entries unless they are language-neutral', async () => {
    const root = makeProject({
      sourceText:
        "import { t } from '@/i18n/mobile-i18n'\nexport const label = t('example.downloadFailed')\n",
      catalogs: {
        en: { example: { downloadFailed: 'Download failed' } },
        ja: { example: { downloadFailed: 'Download failed' } }
      }
    })

    expect(await runFailedVerification(root)).toContain(
      'ja.json copies English instead of using fallback: example.downloadFailed'
    )
  })

  it('rejects translations of exact language-neutral values', async () => {
    const root = makeProject({
      sourceText:
        "import { t } from '@/i18n/mobile-i18n'\nexport const labels = [t('example.provider'), t('example.marker')]\n",
      catalogs: {
        en: { example: { provider: 'OpenAI API', marker: '[x]' } },
        es: { example: { provider: 'API abierta de IA', marker: '[incógnita]' } }
      }
    })

    const report = await runFailedVerification(root)
    expect(report).toContain('es.json must preserve language-neutral value: example.provider')
    expect(report).toContain('es.json must preserve language-neutral value: example.marker')
  })

  it('does not treat URL-prefixed prose as language-neutral', async () => {
    const root = makeProject({
      sourceText:
        "import { t } from '@/i18n/mobile-i18n'\nexport const label = t('example.pairingHint')\n",
      catalogs: {
        en: { example: { pairingHint: 'orca://pair?code=... or paste the code' } },
        ja: { example: { pairingHint: 'orca://pair?code=... or paste the code' } }
      }
    })

    expect(await runFailedVerification(root)).toContain(
      'ja.json copies English instead of using fallback: example.pairingHint'
    )
  })

  it('allows Spanish to preserve the Git term commit', async () => {
    const root = makeProject({
      sourceText:
        "import { t } from '@/i18n/mobile-i18n'\nexport const label = t('example.commitCount', { commitCount: 2 })\n",
      catalogs: {
        en: { example: { commitCount: '{{commitCount}} commits' } },
        es: { example: { commitCount: '{{commitCount}} commits' } }
      }
    })

    await expect(verifyMobileCatalog(root)).resolves.toBe(0)
  })

  it('verifies translation calls in .mts source files', async () => {
    const root = makeProject({
      sourceFileName: 'Example.mts',
      sourceText:
        "import { t } from '@/i18n/mobile-i18n'\nexport const label = t('example.missing')\n",
      catalogs: { en: { example: { known: 'Known' } } }
    })

    expect(await runFailedVerification(root)).toContain('missing English key: example.missing')
  })

  it('enforces Git and agent terminology', async () => {
    const root = makeProject({
      sourceText:
        "import { t } from '@/i18n/mobile-i18n'\nexport const branch = t('example.branch')\nexport const host = t('example.host')\n",
      catalogs: {
        en: { example: { branch: 'Switch branch', host: 'Detecting agents on host' } },
        es: { example: { branch: 'Cambiar sucursal' } },
        zh: { example: { host: '主人正在检测剂' } }
      }
    })

    const report = await runFailedVerification(root)
    expect(report).toContain('translates branch as sucursal')
    expect(report).toContain('uses 主人')
    expect(report).toContain('uses 检测剂')
  })

  it('validates placeholders and extra keys in present translations', async () => {
    const en = { m: { greeting: 'Hello {{name}}' } }
    const root = makeProject({
      sourceText:
        "import { t } from '@/i18n/mobile-i18n'\nexport const label = t('m.greeting', { name: 'Orca' })\n",
      catalogs: {
        en,
        es: { m: { greeting: 'Hola {{wrongName}}', extra: 'Extra' } }
      }
    })

    const report = await runFailedVerification(root)
    expect(report).toContain('es.json placeholder mismatch: m.greeting')
    expect(report).toContain('es.json has extra key: m.extra')
  })

  it('rejects encoded HTML entities that React Native would render literally', async () => {
    const root = makeProject({
      sourceText: "export const label = 'not rendered'\n",
      catalogs: { en: { m: { label: 'Don&apos;t encode &amp; characters' } } }
    })

    expect(await runFailedVerification(root)).toContain(
      'en.json: m.label contains an encoded HTML entity'
    )
  })

  it('rejects empty target translations before i18next can render a blank label', async () => {
    const root = makeProject({
      sourceText: "export const label = 'not rendered'\n",
      catalogs: { en: { m: { label: 'Visible' } }, es: { m: { label: '   ' } } }
    })

    expect(await runFailedVerification(root)).toContain('es.json: m.label must not be empty')
  })

  it('rejects translated technical literals and commands', async () => {
    const root = makeProject({
      sourceText: "export const label = 'not rendered'\n",
      catalogs: {
        en: { m: { command: 'Run pnpm build from orca.yaml' } },
        es: { m: { command: 'Ejecuta compilación pnpm desde Orca.yaml' } }
      }
    })

    const report = await runFailedVerification(root)
    expect(report).toContain('must preserve pnpm build')
    expect(report).toContain('must preserve orca.yaml')
  })

  it('validates native locale paths, zh-Hans mapping, and required keys', async () => {
    const appConfig = defaultAppConfig()
    appConfig.expo.locales['zh-Hans'] = './locales/zh.json'
    const root = makeProject({
      sourceText: "export const label = 'not rendered'\n",
      catalogs: { en: { m: { label: 'Visible' } } },
      nativeCatalogs: {
        es: { ios: { ...NATIVE_CATALOG.ios, NSCameraUsageDescription: undefined } }
      },
      appConfig
    })

    const report = await runFailedVerification(root)
    expect(report).toContain('locale zh-Hans must map to ./locales/zh-Hans.json')
    expect(report).toContain(
      'mobile/locales/es.json missing required native key: ios.NSCameraUsageDescription'
    )
  })

  it('keeps app-config fallbacks aligned with the English native catalog', async () => {
    const appConfig = defaultAppConfig()
    appConfig.expo.plugins[1][1].cameraPermission = 'Different fallback'
    const root = makeProject({
      sourceText: "export const label = 'not rendered'\n",
      catalogs: { en: { m: { label: 'Visible' } } },
      appConfig
    })

    expect(await runFailedVerification(root)).toContain(
      'mobile/app.json English native fallback mismatch: ios.NSCameraUsageDescription'
    )
  })
})
