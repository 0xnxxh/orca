// @vitest-environment happy-dom

import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { createElement } from 'react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { MobileWebBridgeClientError, type MobileWebBridgeClient } from './mobile-web-bridge-client'
import { MobileWebWorkspaces } from './mobile-web-workspaces'

afterEach(cleanup)

describe('mobile web workspaces', () => {
  it('renders a real workspace snapshot and retains it while offline', async () => {
    const workspaceSnapshot = vi.fn().mockResolvedValue({
      workspaces: [
        {
          id: 'workspace-1',
          name: 'Mobile rearchitecture',
          repo: '/repo',
          branch: 'mobile-rearch',
          isActive: true,
          liveTerminalCount: 2
        }
      ],
      truncated: false
    })
    const client = { workspaceSnapshot } as unknown as MobileWebBridgeClient
    const onOpen = vi.fn()
    const view = render(
      createElement(MobileWebWorkspaces, { client, connection: 'connected', onOpen })
    )

    expect(await screen.findByText('Mobile rearchitecture')).toBeTruthy()
    expect(screen.getByText('mobile-rearch')).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: /Mobile rearchitecture/ }))
    expect(onOpen).toHaveBeenCalledWith(expect.objectContaining({ id: 'workspace-1' }))
    view.rerender(createElement(MobileWebWorkspaces, { client, connection: 'offline', onOpen }))

    expect(screen.getByText('Mobile rearchitecture')).toBeTruthy()
    expect(screen.getByText('Offline — showing the last workspace list.')).toBeTruthy()
  })

  it('offers retry for a transient bridge failure', async () => {
    const workspaceSnapshot = vi
      .fn()
      .mockRejectedValueOnce(new MobileWebBridgeClientError('timeout', true))
      .mockResolvedValueOnce({ workspaces: [], truncated: false })
    const client = { workspaceSnapshot } as unknown as MobileWebBridgeClient
    render(
      createElement(MobileWebWorkspaces, {
        client,
        connection: 'connected',
        onOpen: vi.fn()
      })
    )

    expect(await screen.findByText('Workspaces unavailable')).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: 'Try again' }))

    expect(await screen.findByText('No workspaces available')).toBeTruthy()
    expect(workspaceSnapshot).toHaveBeenCalledTimes(2)
  })
})
