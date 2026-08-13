// @vitest-environment happy-dom

import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { getDefaultSettings } from '../../../../shared/constants'
import { GeneralWorkspaceSettingsSection } from './GeneralWorkspaceSettingsSection'

vi.mock('./WorkspaceDirectorySetting', () => ({ WorkspaceDirectorySetting: () => null }))
vi.mock('./OpenInMenuSetting', () => ({ OpenInMenuSetting: () => null }))

let container: HTMLDivElement
let root: Root

beforeEach(() => {
  container = document.createElement('div')
  document.body.appendChild(container)
  root = createRoot(container)
})

afterEach(() => {
  act(() => root.unmount())
  container.remove()
})

describe('GeneralWorkspaceSettingsSection external visibility', () => {
  it('writes the global Show default without touching repositories', () => {
    const updateSettings = vi.fn()
    act(() => {
      root.render(
        <GeneralWorkspaceSettingsSection
          settings={getDefaultSettings('/home/user')}
          updateSettings={updateSettings}
        />
      )
    })

    const show = container.querySelector<HTMLButtonElement>('[role="radio"][aria-checked="false"]')
    expect(show?.textContent).toBe('Show')
    act(() => show?.click())

    expect(updateSettings).toHaveBeenCalledWith({
      worktreeVisibilityDefaults: { external: 'show' }
    })
  })

  it('disables the control when the active host does not support global defaults', () => {
    act(() => {
      root.render(
        <GeneralWorkspaceSettingsSection
          settings={{
            ...getDefaultSettings('/home/user'),
            worktreeVisibilityDefaults: undefined
          }}
          updateSettings={vi.fn()}
        />
      )
    })

    expect(container.querySelectorAll('[role="radio"][aria-disabled="true"]')).toHaveLength(2)
  })
})
