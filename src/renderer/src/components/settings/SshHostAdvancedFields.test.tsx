import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it, vi } from 'vitest'
import { SshHostAdvancedFields } from './SshHostAdvancedFields'
import { EMPTY_FORM } from './ssh-target-draft'

describe('SshHostAdvancedFields', () => {
  it('renders bounded terminal output as a per-target experimental option', () => {
    const markup = renderToStaticMarkup(
      <SshHostAdvancedFields
        open
        onOpenChange={vi.fn()}
        form={{ ...EMPTY_FORM, experimentalPtySourceCreditV1: true }}
        disabled={false}
        onFormChange={vi.fn()}
      />
    )

    expect(markup).toContain('Bounded terminal output (experimental)')
    expect(markup).toContain('Limits buffered terminal output')
    expect(markup).toContain('aria-checked="true"')
    expect(markup).toContain('Toggle bounded terminal output')
  })
})
