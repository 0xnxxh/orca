import { describe, expect, it } from 'vitest'
import {
  readChromiumRowPartition,
  readFirefoxOriginAttributesPartition,
  readJsonCookiePartition
} from './browser-cookie-source-partition'

const MODERN_COLUMNS = new Set([
  'host_key',
  'name',
  'top_frame_site_key',
  'has_cross_site_ancestor'
])

describe('readChromiumRowPartition', () => {
  it('reads a partitioned row as both halves of the partition key', () => {
    expect(
      readChromiumRowPartition(
        { top_frame_site_key: 'https://top.example', has_cross_site_ancestor: 1n },
        MODERN_COLUMNS
      )
    ).toEqual({
      status: 'partitioned',
      partitionKey: { topLevelSite: 'https://top.example', hasCrossSiteAncestor: true }
    })
  })

  it('carries a false cross-site-ancestor rather than defaulting it to true', () => {
    expect(
      readChromiumRowPartition(
        { top_frame_site_key: 'https://top.example', has_cross_site_ancestor: 0n },
        MODERN_COLUMNS
      )
    ).toEqual({
      status: 'partitioned',
      partitionKey: { topLevelSite: 'https://top.example', hasCrossSiteAncestor: false }
    })
  })

  it('reads an empty partition site as unpartitioned', () => {
    expect(
      readChromiumRowPartition(
        { top_frame_site_key: '', has_cross_site_ancestor: 0n },
        MODERN_COLUMNS
      )
    ).toEqual({ status: 'unpartitioned' })
  })

  // Why: a schema predating cookie partitioning genuinely has no partitioned rows, so importing
  // every one of its cookies unpartitioned is faithful rather than lossy.
  it('reads a schema without the partition column as unpartitioned', () => {
    expect(readChromiumRowPartition({ name: 'sid' }, new Set(['host_key', 'name']))).toEqual({
      status: 'unpartitioned'
    })
  })

  // Why (STA-4300): the ancestor bit selects which partition the cookie lands in. Guessing it files
  // the cookie under a partition the site never reads — indistinguishable from losing it.
  it('refuses a partitioned row whose schema has no cross-site-ancestor column', () => {
    const result = readChromiumRowPartition(
      { top_frame_site_key: 'https://top.example' },
      new Set(['host_key', 'name', 'top_frame_site_key'])
    )

    expect(result.status).toBe('unreadable')
    expect(result).toHaveProperty('reason', expect.stringContaining('cross-site-ancestor'))
  })

  it('refuses a partitioned row whose ancestor flag is not an integer', () => {
    expect(
      readChromiumRowPartition(
        { top_frame_site_key: 'https://top.example', has_cross_site_ancestor: null },
        MODERN_COLUMNS
      ).status
    ).toBe('unreadable')
  })

  it('refuses a partition site column that is not text', () => {
    expect(
      readChromiumRowPartition(
        { top_frame_site_key: 42, has_cross_site_ancestor: 1n },
        MODERN_COLUMNS
      ).status
    ).toBe('unreadable')
  })
})

describe('readJsonCookiePartition', () => {
  // Why: every mainstream exporter omits the field for ordinary cookies, so absence has to mean
  // unpartitioned or whole exports would be rejected.
  it('reads an absent partitionKey as unpartitioned', () => {
    expect(readJsonCookiePartition(undefined)).toEqual({ status: 'unpartitioned' })
    expect(readJsonCookiePartition(null)).toEqual({ status: 'unpartitioned' })
  })

  it('reads a complete partitionKey object', () => {
    expect(
      readJsonCookiePartition({ topLevelSite: 'https://top.example', hasCrossSiteAncestor: true })
    ).toEqual({
      status: 'partitioned',
      partitionKey: { topLevelSite: 'https://top.example', hasCrossSiteAncestor: true }
    })
  })

  // Why: exporters that emit only topLevelSite carry no ancestor bit. Skipping is reported; a
  // guessed bit would be a silent misfile.
  it('refuses a partitionKey missing the cross-site-ancestor bit', () => {
    expect(readJsonCookiePartition({ topLevelSite: 'https://top.example' }).status).toBe(
      'unreadable'
    )
  })

  it('refuses the legacy string partitionKey form', () => {
    expect(readJsonCookiePartition('https://top.example').status).toBe('unreadable')
  })

  it('refuses a partitionKey with a non-boolean ancestor bit', () => {
    expect(
      readJsonCookiePartition({ topLevelSite: 'https://top.example', hasCrossSiteAncestor: 'yes' })
        .status
    ).toBe('unreadable')
  })

  it('refuses an array or empty-site partitionKey', () => {
    expect(readJsonCookiePartition([]).status).toBe('unreadable')
    expect(readJsonCookiePartition({ topLevelSite: '', hasCrossSiteAncestor: true }).status).toBe(
      'unreadable'
    )
  })
})

describe('readFirefoxOriginAttributesPartition', () => {
  it('reads an empty or absent originAttributes as unpartitioned', () => {
    expect(readFirefoxOriginAttributesPartition('')).toEqual({ status: 'unpartitioned' })
    expect(readFirefoxOriginAttributesPartition(null)).toEqual({ status: 'unpartitioned' })
  })

  it('reads a suffix with no partitionKey as unpartitioned', () => {
    expect(readFirefoxOriginAttributesPartition('^userContextId=3')).toEqual({
      status: 'unpartitioned'
    })
  })

  // Why: dFPI is storage isolation Firefox imposed on an ordinary cookie. The cookie the server set
  // is genuinely unpartitioned, and Chromium re-derives its own third-party isolation after import,
  // so importing it unpartitioned is faithful — skipping it would drop cookies that work today.
  it('reads a two-part dFPI partitionKey as unpartitioned', () => {
    expect(readFirefoxOriginAttributesPartition('^partitionKey=(https,example.com)')).toEqual({
      status: 'unpartitioned'
    })
  })

  it('reads a percent-encoded dFPI partitionKey as unpartitioned', () => {
    expect(
      readFirefoxOriginAttributesPartition('%5EpartitionKey%3D%28https%2Cexample.com%29')
    ).toEqual({ status: 'unpartitioned' })
  })

  // Why (STA-4300): the extra component is isPartitionedAttributeSet — the server sent
  // `Partitioned`, so this is a real CHIPS cookie. Firefox has no cross-site-ancestor bit, so its
  // Chromium identity cannot be rebuilt and the cookie must be skipped, never written unpartitioned.
  it('refuses a partitioned-attribute (CHIPS) partitionKey', () => {
    const result = readFirefoxOriginAttributesPartition('^partitionKey=(https,example.com,f)')

    expect(result.status).toBe('unreadable')
    expect(result).toHaveProperty('reason', expect.stringContaining('cross-site-ancestor'))
  })

  it('refuses an originAttributes value that is not text', () => {
    expect(readFirefoxOriginAttributesPartition(42).status).toBe('unreadable')
  })
})
