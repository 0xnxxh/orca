// @vitest-environment happy-dom

import { cleanup, fireEvent, render, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { useState } from 'react'
import { Dialog, DialogContent, DialogTitle } from './dialog'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
  DropdownMenuTrigger
} from './dropdown-menu'
import { Popover, PopoverContent, PopoverTrigger } from './popover'
import { Sheet, SheetContent, SheetTitle } from './sheet'

type SurfaceProps = { onEscapeKeyDown: (event: KeyboardEvent) => void }

function ControlledPopover({ onEscapeKeyDown }: SurfaceProps): React.JSX.Element {
  const [open, setOpen] = useState(true)
  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger>Open</PopoverTrigger>
      <PopoverContent onEscapeKeyDown={onEscapeKeyDown}>
        <input aria-label="Draft" />
      </PopoverContent>
    </Popover>
  )
}

function ControlledDialog({ onEscapeKeyDown }: SurfaceProps): React.JSX.Element {
  const [open, setOpen] = useState(true)
  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogContent onEscapeKeyDown={onEscapeKeyDown}>
        <DialogTitle>Draft dialog</DialogTitle>
        <input aria-label="Draft" />
      </DialogContent>
    </Dialog>
  )
}

function ControlledSheet({ onEscapeKeyDown }: SurfaceProps): React.JSX.Element {
  const [open, setOpen] = useState(true)
  return (
    <Sheet open={open} onOpenChange={setOpen}>
      <SheetContent onEscapeKeyDown={onEscapeKeyDown}>
        <SheetTitle>Draft sheet</SheetTitle>
        <input aria-label="Draft" />
      </SheetContent>
    </Sheet>
  )
}

function ControlledDropdownSub({ onEscapeKeyDown }: SurfaceProps): React.JSX.Element {
  const [open, setOpen] = useState(true)
  return (
    <DropdownMenu open={open} onOpenChange={setOpen}>
      <DropdownMenuTrigger>Open</DropdownMenuTrigger>
      <DropdownMenuContent>
        <DropdownMenuSub>
          <DropdownMenuSubTrigger>More</DropdownMenuSubTrigger>
          <DropdownMenuSubContent onEscapeKeyDown={onEscapeKeyDown}>
            <input aria-label="Draft" />
          </DropdownMenuSubContent>
        </DropdownMenuSub>
      </DropdownMenuContent>
    </DropdownMenu>
  )
}

const SURFACES = [
  ['PopoverContent', ControlledPopover],
  ['DialogContent', ControlledDialog],
  ['SheetContent', ControlledSheet]
] as const

afterEach(cleanup)

describe('Radix dismissable-layer IME ownership', () => {
  it.each(SURFACES)('%s keeps its draft open for a marked Escape', (_name, Surface) => {
    const onEscapeKeyDown = vi.fn()
    const view = render(<Surface onEscapeKeyDown={onEscapeKeyDown} />)
    const input = view.getByRole('textbox', { name: 'Draft' })

    fireEvent.keyDown(input, { key: 'Escape', keyCode: 27, isComposing: true })

    expect(view.queryByRole('textbox', { name: 'Draft' })).not.toBeNull()
    expect(onEscapeKeyDown).not.toHaveBeenCalled()
  })

  it.each(SURFACES)('%s still dismisses for an ordinary Escape', (_name, Surface) => {
    const onEscapeKeyDown = vi.fn()
    const view = render(<Surface onEscapeKeyDown={onEscapeKeyDown} />)
    const input = view.getByRole('textbox', { name: 'Draft' })

    fireEvent.keyDown(input, { key: 'Escape', keyCode: 27 })

    expect(view.queryByRole('textbox', { name: 'Draft' })).toBeNull()
    expect(onEscapeKeyDown).toHaveBeenCalledOnce()
  })

  async function openDropdownSub(onEscapeKeyDown: (event: KeyboardEvent) => void) {
    const view = render(<ControlledDropdownSub onEscapeKeyDown={onEscapeKeyDown} />)
    fireEvent.keyDown(view.getByRole('menuitem', { name: 'More' }), { key: 'ArrowRight' })
    const input = await view.findByRole('textbox', { name: 'Draft' })
    return { input, view }
  }

  it('keeps DropdownMenuSubContent open for a marked Escape', async () => {
    const onEscapeKeyDown = vi.fn()
    const { input, view } = await openDropdownSub(onEscapeKeyDown)

    fireEvent.keyDown(input, { key: 'Escape', keyCode: 27, isComposing: true })

    expect(view.queryByRole('textbox', { name: 'Draft' })).not.toBeNull()
    expect(onEscapeKeyDown).not.toHaveBeenCalled()
  })

  it('still dismisses DropdownMenuSubContent for an ordinary Escape', async () => {
    const onEscapeKeyDown = vi.fn()
    const { input, view } = await openDropdownSub(onEscapeKeyDown)

    fireEvent.keyDown(input, { key: 'Escape', keyCode: 27 })

    await waitFor(() => expect(view.queryByRole('textbox', { name: 'Draft' })).toBeNull())
    expect(onEscapeKeyDown).toHaveBeenCalledOnce()
  })
})
