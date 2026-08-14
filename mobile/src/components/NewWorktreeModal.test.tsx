import { createElement } from 'react'
import { act, create } from 'react-test-renderer'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { RpcClient } from '../transport/rpc-client'

const asyncStorage = vi.hoisted(() => ({
  getItem: vi.fn().mockResolvedValue(null),
  setItem: vi.fn().mockResolvedValue(undefined),
  removeItem: vi.fn().mockResolvedValue(undefined)
}))
vi.mock('@react-native-async-storage/async-storage', () => ({ default: asyncStorage }))
vi.mock('react-native', () => ({
  ActivityIndicator: 'ActivityIndicator',
  FlatList: 'FlatList',
  Image: 'Image',
  Keyboard: { dismiss: vi.fn() },
  Linking: { openURL: vi.fn() },
  Modal: 'Modal',
  ScrollView: 'ScrollView',
  Platform: { OS: 'ios', select: (options: { ios?: unknown }) => options.ios },
  Pressable: 'Pressable',
  StyleSheet: { create: <T,>(styles: T) => styles },
  Switch: 'Switch',
  Text: 'Text',
  TextInput: 'TextInput',
  View: 'View'
}))
// Every icon in the drawer tree renders as a host element named after itself.
vi.mock(
  'lucide-react-native',
  () =>
    new Proxy(
      {},
      {
        get: (_target, name) => (typeof name === 'string' ? name : undefined),
        has: () => true
      }
    )
)
vi.mock('./BottomDrawer', () => ({ BottomDrawer: 'BottomDrawer' }))
vi.mock('./bottom-drawer-modal-host', () => ({ BottomDrawerModalHost: 'BottomDrawerModalHost' }))
vi.mock('./PickerListDrawer', () => ({ PickerListDrawer: 'PickerListDrawer' }))
vi.mock('./MobileAgentIcon', () => ({ MobileAgentIcon: 'MobileAgentIcon' }))
vi.mock('./TaskProviderLogo', () => ({ TaskProviderLogo: 'TaskProviderLogo' }))

import { setCachedRepos } from '../cache/repo-cache'
import { NewWorktreeModal } from './NewWorktreeModal'

const repos = [{ id: 'repo-1', displayName: 'orca', path: '/src/orca', kind: 'git' }]
type TestRenderer = ReturnType<typeof create>

function repoPickerItems(renderer: TestRenderer | null): { label: string; detail: string }[] {
  const pickers = renderer?.root.findAll((node) => node.type === 'PickerListDrawer') ?? []
  const repoPicker = pickers.find((node) => node.props.title === 'Repository')
  return repoPicker?.props.items ?? []
}

describe('NewWorktreeModal repo list', () => {
  let renderer: TestRenderer | null = null

  beforeEach(() => {
    setCachedRepos('host-1', repos)
  })

  afterEach(() => {
    act(() => renderer?.unmount())
    renderer = null
  })

  it('keeps the cached repos when the in-flight repo.list rejects on a dropped connection', async () => {
    const sendRequest = vi.fn().mockImplementation((method: string) => {
      if (method === 'repo.list') {
        return Promise.reject(new Error('connection closed'))
      }
      return new Promise(() => {})
    })
    const client = { sendRequest } as unknown as RpcClient

    await act(async () => {
      renderer = create(
        createElement(NewWorktreeModal, {
          visible: true,
          client,
          hostId: 'host-1',
          onCreated: () => {},
          onClose: () => {}
        })
      )
      await Promise.resolve()
    })
    await act(async () => {
      await Promise.resolve()
    })

    expect(sendRequest).toHaveBeenCalledWith('repo.list')
    expect(repoPickerItems(renderer)).toEqual([
      expect.objectContaining({ label: 'orca', detail: 'Local · /src/orca' })
    ])
  })

  it('labels same-name local and SSH repositories with their locations', async () => {
    const listedRepos = [
      ...repos,
      {
        id: 'repo-2',
        displayName: 'orca',
        path: '/home/dev/orca',
        connectionId: 'build-server',
        kind: 'git'
      }
    ]
    const client = {
      sendRequest: vi
        .fn()
        .mockImplementation((method: string) =>
          method === 'repo.list'
            ? Promise.resolve({ ok: true, result: { repos: listedRepos } })
            : new Promise(() => {})
        )
    } as unknown as RpcClient

    await act(async () => {
      renderer = create(
        createElement(NewWorktreeModal, {
          visible: true,
          client,
          hostId: 'host-1',
          onCreated: () => {},
          onClose: () => {}
        })
      )
      await Promise.resolve()
    })

    expect(repoPickerItems(renderer)).toEqual([
      expect.objectContaining({ label: 'orca', detail: 'Local · /src/orca' }),
      expect.objectContaining({
        label: 'orca',
        detail: 'SSH · build-server · /home/dev/orca'
      })
    ])
  })
})
