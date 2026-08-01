import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'

import { describe, expect, it, vi } from 'vitest'

import { main as verifyMobileCatalog } from './verify-mobile-localization-catalog.mjs'

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

function makeProject({ sourceText, catalogs, nativeCatalogs, appConfig }) {
  const root = mkdtempSync(path.join(tmpdir(), 'orca-mobile-localization-'))
  const appDirectory = path.join(root, 'mobile', 'app')
  const sourceDirectory = path.join(root, 'mobile', 'src')
  const localeDirectory = path.join(sourceDirectory, 'i18n', 'locales')
  const nativeLocaleDirectory = path.join(root, 'mobile', 'locales')
  mkdirSync(appDirectory, { recursive: true })
  mkdirSync(localeDirectory, { recursive: true })
  mkdirSync(nativeLocaleDirectory, { recursive: true })
  writeFileSync(path.join(appDirectory, 'Example.tsx'), sourceText, 'utf8')
  writeJson(path.join(root, 'mobile', 'app.json'), appConfig ?? defaultAppConfig())

  for (const locale of LOCALES) {
    writeJson(path.join(localeDirectory, `${locale}.json`), catalogs?.[locale] ?? catalogs.en)
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
    const catalog = { m: { greeting: 'Hello {{name}}', farewell: 'Bye {{name}}' } }
    const root = makeProject({
      sourceText:
        "import { t } from '@/i18n/mobile-i18n'\nconst name = 'Orca'\nexport const label = t(name ? 'm.greeting' : 'm.farewell', { name })\n",
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
    const en = { m: { greeting: 'Hello {{name}}', farewell: 'Bye' } }
    const root = makeProject({
      sourceText:
        "import { t } from '@/i18n/mobile-i18n'\nexport const label = t('m.greeting', { name: 'Orca' })\n",
      catalogs: {
        en,
        es: { m: { greeting: 'Hola {{name}}' } }
      }
    })

    await expect(verifyMobileCatalog(root)).resolves.toBe(0)
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
