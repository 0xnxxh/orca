// @vitest-environment happy-dom

import { act, cleanup, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import type { ComponentProps } from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { NeedsSetupProjectHostOption } from '@/lib/project-host-setup-options'

const storeMocks = vi.hoisted(() => ({
  setupProjectExistingFolder: vi.fn(),
  setupProjectClone: vi.fn()
}))

vi.mock('@/store', () => ({
  useAppStore: (selector: (state: unknown) => unknown) => selector(storeMocks)
}))

vi.mock('@/components/sidebar/RemoteFileBrowser', () => ({
  RemoteFileBrowser: ({
    targetId,
    onSelect,
    onCancel
  }: {
    targetId?: string
    onSelect: (path: string) => void
    onCancel: () => void
  }) => (
    <div data-testid="remote-file-browser" data-target={targetId ?? ''}>
      <button type="button" onClick={() => onSelect('/remote/orca')}>
        Select remote folder
      </button>
      <button type="button" onClick={onCancel}>
        Cancel browse
      </button>
    </div>
  )
}))

import { SetProjectLocationDialog } from './SetProjectLocationDialog'

const option: NeedsSetupProjectHostOption = {
  kind: 'needs-setup',
  id: 'needs-setup:ssh:openclaw',
  projectId: 'project-orca',
  hostId: 'ssh:openclaw',
  label: 'openclaw',
  detail: 'Project location not set',
  isAvailable: true,
  attention: false,
  canSetLocation: true
}

function renderDialog(
  overrides: Partial<ComponentProps<typeof SetProjectLocationDialog>> = {}
): ReturnType<typeof userEvent.setup> {
  const user = userEvent.setup()
  render(
    <SetProjectLocationDialog
      option={option}
      projectName="orca"
      projectKind="git"
      defaultCloneUrl="git@github.com:stablyai/orca.git"
      onOpenChange={vi.fn()}
      onReady={vi.fn()}
      {...overrides}
    />
  )
  return user
}

beforeEach(() => {
  storeMocks.setupProjectExistingFolder.mockReset()
  storeMocks.setupProjectClone.mockReset()
  storeMocks.setupProjectExistingFolder.mockResolvedValue({
    setup: { id: 'setup-openclaw' }
  })
  storeMocks.setupProjectClone.mockResolvedValue({
    setup: { id: 'setup-openclaw-clone' }
  })
})

afterEach(() => {
  cleanup()
})

describe('SetProjectLocationDialog', () => {
  it('keeps the parent caller in charge of close and saves an existing folder', async () => {
    const onOpenChange = vi.fn()
    const onReady = vi.fn()
    const user = renderDialog({ onOpenChange, onReady })

    expect(screen.getByTestId('set-project-location-dialog')).toBeTruthy()
    expect(screen.getByText('Set project location')).toBeTruthy()
    expect(screen.getByText('Choose where orca lives on openclaw.')).toBeTruthy()

    await user.click(screen.getByRole('button', { name: /Browse folder/ }))
    await user.click(screen.getByRole('button', { name: 'Browse host filesystem' }))
    await user.click(screen.getByRole('button', { name: 'Select remote folder' }))
    await user.click(screen.getByRole('button', { name: 'Set location' }))

    expect(storeMocks.setupProjectExistingFolder).toHaveBeenCalledWith({
      projectId: 'project-orca',
      hostId: 'ssh:openclaw',
      path: '/remote/orca',
      kind: 'git',
      displayName: 'orca'
    })
    expect(onReady).toHaveBeenCalledWith('setup-openclaw')
    expect(onOpenChange).not.toHaveBeenCalled()
  })

  it('clones onto the selected host', async () => {
    const onReady = vi.fn()
    const user = renderDialog({ onReady })

    await user.click(screen.getByRole('button', { name: /Clone from URL/ }))
    await user.click(screen.getByRole('button', { name: 'Browse host filesystem' }))
    await user.click(screen.getByRole('button', { name: 'Select remote folder' }))
    await user.click(screen.getByRole('button', { name: 'Clone' }))

    expect(storeMocks.setupProjectClone).toHaveBeenCalledWith({
      projectId: 'project-orca',
      hostId: 'ssh:openclaw',
      url: 'git@github.com:stablyai/orca.git',
      destination: '/remote/orca',
      displayName: 'orca'
    })
    expect(onReady).toHaveBeenCalledWith('setup-openclaw-clone')
  })

  it('hides clone for folder projects', () => {
    renderDialog({ projectKind: 'folder' })
    expect(screen.queryByRole('button', { name: /Clone from URL/ })).toBeNull()
  })

  it('does not render when no host is selected', () => {
    render(
      <SetProjectLocationDialog
        option={null}
        projectName="orca"
        projectKind="git"
        defaultCloneUrl=""
        onOpenChange={vi.fn()}
        onReady={vi.fn()}
      />
    )
    expect(screen.queryByTestId('set-project-location-dialog')).toBeNull()
  })

  it('notifies the parent when dismissed', async () => {
    const onOpenChange = vi.fn()
    renderDialog({ onOpenChange })
    await act(async () => {
      document.querySelector<HTMLButtonElement>('[data-slot="dialog-close"]')?.click()
    })
    expect(onOpenChange).toHaveBeenCalledWith(false)
  })
})
