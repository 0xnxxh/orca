import { describe, expect, it } from 'vitest'

import {
  buildLinearPersonalApiKeySettingsUrl,
  buildLinearTeamUrl,
  buildLinearWorkspaceApiSettingsUrl,
  findLinearIssueExactReferenceMatch,
  getLinearOrganizationUrlKeyFromIssueUrl,
  isLinearIssueExactReferenceMatch,
  parseLinearIssueInput
} from './linear-links'

describe('linear links', () => {
  it('builds team URLs from workspace and team keys', () => {
    expect(buildLinearTeamUrl({ organizationUrlKey: 'acme', teamKey: 'ENG' })).toBe(
      'https://linear.app/acme/team/ENG/all'
    )
  })

  it('encodes URL path segments', () => {
    expect(buildLinearTeamUrl({ organizationUrlKey: 'acme inc', teamKey: 'A/B' })).toBe(
      'https://linear.app/acme%20inc/team/A%2FB/all'
    )
  })

  it('extracts the workspace URL key from Linear issue URLs', () => {
    expect(getLinearOrganizationUrlKeyFromIssueUrl('https://linear.app/acme/issue/ENG-1')).toBe(
      'acme'
    )
  })

  it('builds organization-scoped API key settings URLs', () => {
    expect(buildLinearPersonalApiKeySettingsUrl('acme inc')).toBe(
      'https://linear.app/acme%20inc/settings/account/security'
    )
    expect(buildLinearWorkspaceApiSettingsUrl('acme/inc')).toBe(
      'https://linear.app/acme%2Finc/settings/api'
    )
  })

  it('falls back to global API settings URLs when no organization slug is available', () => {
    expect(buildLinearPersonalApiKeySettingsUrl()).toBe(
      'https://linear.app/settings/account/security'
    )
    expect(buildLinearWorkspaceApiSettingsUrl('   ')).toBe('https://linear.app/settings/api')
  })

  it('parses bare Linear issue identifiers', () => {
    expect(parseLinearIssueInput('eng-123')).toEqual({ identifier: 'ENG-123' })
  })

  it('parses Linear issue URLs with organization URL keys', () => {
    expect(parseLinearIssueInput('https://linear.app/acme/issue/eng-123/fix-auth')).toEqual({
      identifier: 'ENG-123',
      organizationUrlKey: 'acme'
    })
    expect(parseLinearIssueInput('https://linear.app/stably/issue/STA-335/test-issue')).toEqual({
      identifier: 'STA-335',
      organizationUrlKey: 'stably'
    })
  })

  it('rejects non-Linear issue input', () => {
    expect(parseLinearIssueInput('https://linear.app/acme/settings/api')).toBeNull()
    expect(parseLinearIssueInput('https://linear.app/acme/team/ENG/all')).toBeNull()
    expect(parseLinearIssueInput('https://linear.app/acme/settings/issue/ENG-123')).toBeNull()
    expect(parseLinearIssueInput('https://example.com/acme/issue/ENG-123')).toBeNull()
    expect(parseLinearIssueInput('https://linear.app/acme/issue/not-an-identifier')).toBeNull()
    expect(parseLinearIssueInput('not an issue')).toBeNull()
  })

  it('matches exact issue references with strict organization verification', () => {
    const issue = {
      identifier: 'ENG-123',
      url: 'https://linear.app/AcMe/issue/ENG-123/fix-auth'
    }

    expect(
      isLinearIssueExactReferenceMatch(issue, {
        identifier: 'eng-123',
        organizationUrlKey: 'acme'
      })
    ).toBe(true)
    expect(
      isLinearIssueExactReferenceMatch(issue, {
        identifier: 'ENG-123',
        organizationUrlKey: 'other'
      })
    ).toBe(false)
    expect(isLinearIssueExactReferenceMatch(issue, { identifier: 'ENG-123' })).toBe(true)
    expect(
      isLinearIssueExactReferenceMatch(
        { identifier: 'ENG-123', url: 'https://example.com/acme/issue/ENG-123' },
        { identifier: 'ENG-123', organizationUrlKey: 'acme' }
      )
    ).toBe(false)
  })

  it('selects the organization-matching issue when identifiers collide', () => {
    const issues = [
      { identifier: 'ENG-42', url: 'https://linear.app/wrong/issue/ENG-42' },
      { identifier: 'ENG-42', url: 'https://linear.app/acme/issue/ENG-42' }
    ]

    expect(
      findLinearIssueExactReferenceMatch(issues, {
        identifier: 'ENG-42',
        organizationUrlKey: 'ACME'
      })
    ).toBe(issues[1])
  })
})
