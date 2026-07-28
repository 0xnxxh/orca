// @vitest-environment happy-dom

import { act, createElement } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { I18nextProvider } from 'react-i18next'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { getDefaultSettings } from '../../../shared/constants'
import { UI_LANGUAGE_SPANISH } from '../../../shared/ui-language'
import { useAppStore } from '@/store'
import { i18n } from '@/i18n/i18n'
import { useMacosTccPromptNotice } from './useMacosTccPromptNotice'

const subscribeToMacosTccPromptNotice = vi.hoisted(() => vi.fn(() => vi.fn()))

vi.mock('./macos-tcc-prompt-notice-subscription', () => ({
  dismissMacosTccPromptNotice: vi.fn(),
  subscribeToMacosTccPromptNotice
}))

const initialAppState = useAppStore.getInitialState()
let root: Root | null = null

function NoticeProbe(): null {
  useMacosTccPromptNotice()
  return null
}

beforeEach(async () => {
  useAppStore.setState(initialAppState, true)
  subscribeToMacosTccPromptNotice.mockClear()
  await i18n.changeLanguage('en')
})

afterEach(async () => {
  if (root) {
    await act(async () => root?.unmount())
    root = null
  }
  useAppStore.setState(initialAppState, true)
})

it('waits for the persisted locale catalog before consuming the one-time notice', async () => {
  const container = document.createElement('div')
  root = createRoot(container)
  await act(async () => {
    root?.render(createElement(I18nextProvider, { i18n }, createElement(NoticeProbe)))
  })
  expect(subscribeToMacosTccPromptNotice).not.toHaveBeenCalled()

  await act(async () => {
    useAppStore.setState({
      settings: { ...getDefaultSettings('/tmp'), uiLanguage: UI_LANGUAGE_SPANISH }
    })
  })
  expect(subscribeToMacosTccPromptNotice).not.toHaveBeenCalled()

  await act(async () => {
    await i18n.changeLanguage('es')
  })
  expect(subscribeToMacosTccPromptNotice).toHaveBeenCalledOnce()
})
