/**
 * Vectors verified against OpenSSH 10.2p1 — `ssh-keygen -H` for the hashed entries and a throwaway
 * sshd with `-v` for the verdicts — rather than derived from this implementation. That matters:
 * a parser test written from its own parser passes by construction.
 */
import { describe, expect, it } from 'vitest'
import {
  hostCandidatePasses,
  matchKnownHosts,
  parseKnownHosts,
  parseKnownHostsLine,
  readHostKeyType
} from './ssh-known-hosts'

const ED_A = 'AAAAC3NzaC1lZDI1NTE5AAAAIKqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqq'
const ED_B = 'AAAAC3NzaC1lZDI1NTE5AAAAILu7u7u7u7u7u7u7u7u7u7u7u7u7u7u7u7u7u7u7u7u7'
const RSA_A =
  'AAAAB3NzaC1yc2EAAABAzMzMzMzMzMzMzMzMzMzMzMzMzMzMzMzMzMzMzMzMzMzMzMzMzMzMzMzMzMzMzMzMzMzMzMzMzMzMzMzMzMzMzA=='

/** `ssh-keygen -H` output; the salt/hash pair is real, not synthesised here. */
const HASHED_EXAMPLE_COM = '|1|qvIayk/BTpSrSmc/i3iM4cyYx+8=|6ysCq72Bg48mNavekN+FLrdPc/I='
const HASHED_EXAMPLE_COM_2222 = '|1|qsCyiGgRmqnaNrHKZUgVKG57bnQ=|12y3NTllwASTDOM0EVoQZiVgg9U='

const blob = (base64: string): Buffer => Buffer.from(base64, 'base64')
const line = (hosts: string, key: string, type = 'ssh-ed25519'): string => `${hosts} ${type} ${key}`

type Query = { host?: string; port?: number; key: string }

function verdict(contents: string, query: Query): string {
  return matchKnownHosts(parseKnownHosts(contents), {
    host: query.host ?? 'example.com',
    port: query.port ?? 22,
    keyType: readHostKeyType(blob(query.key)) ?? '',
    key: blob(query.key)
  })
}

describe('known_hosts parsing', () => {
  it('reads the algorithm from the blob rather than trusting the line', () => {
    expect(readHostKeyType(blob(ED_A))).toBe('ssh-ed25519')
    expect(readHostKeyType(blob(RSA_A))).toBe('ssh-rsa')
  })

  it.each([
    ['blank', '   '],
    ['comment', '# a comment'],
    ['too few fields', 'example.com ssh-ed25519'],
    ['unrecognised marker', `@bogus ${line('example.com', ED_A)}`],
    ['type field disagreeing with the blob', `example.com ssh-rsa ${ED_A}`],
    ['empty salt', `|1||6ysCq72Bg48mNavekN+FLrdPc/I= ssh-ed25519 ${ED_A}`],
    ['hash that is not 20 bytes', `|1|qvIayk/BTpSrSmc/i3iM4cyYx+8=|AAAA ssh-ed25519 ${ED_A}`],
    ['wrong hashed field count', `|1|a|b|c ssh-ed25519 ${ED_A}`],
    ['undecodable key', 'example.com ssh-ed25519 !!!not-base64!!!']
  ])('rejects %s', (_label, raw) => {
    expect(parseKnownHostsLine(raw)).toBeUndefined()
  })

  it.each([
    ['empty buffer', Buffer.alloc(0)],
    ['truncated length prefix', Buffer.alloc(2)],
    ['length running past the end', Buffer.from([0, 0, 0xff, 0xff, 1, 2, 3, 4])],
    ['zero length', Buffer.from([0, 0, 0, 0, 1, 2, 3, 4])]
  ])('refuses a malformed blob: %s', (_label, buffer) => {
    expect(readHostKeyType(buffer)).toBeUndefined()
  })
})

describe('candidate passes', () => {
  it('uses the bare host on the default port', () => {
    expect(hostCandidatePasses('Example.com', 22)).toEqual([['example.com']])
  })

  // OpenSSH logs "checking without port identifier" — the bare form is a real second pass.
  it('tries the bracketed form first and falls back to bare off-port', () => {
    expect(hostCandidatePasses('example.com', 2222)).toEqual([
      ['[example.com]:2222'],
      ['example.com']
    ])
  })
})

describe('matching a presented key', () => {
  it('matches an exact line', () => {
    expect(verdict(line('example.com', ED_A), { key: ED_A })).toBe('match')
  })

  it('matches case-insensitively', () => {
    expect(verdict(line('example.com', ED_A), { host: 'EXAMPLE.COM', key: ED_A })).toBe('match')
  })

  it('reports a changed key of the same type', () => {
    expect(verdict(line('example.com', ED_A), { key: ED_B })).toBe('mismatch')
  })

  it.each([
    ['another host', line('example.com', ED_A), 'other.com'],
    ['an empty file', '', 'example.com']
  ])('reports unknown for %s', (_label, contents, host) => {
    expect(verdict(contents, { host, key: ED_A })).toBe('unknown')
  })

  it('matches any host in a comma list', () => {
    const contents = line('a.example.com,b.example.com,1.2.3.4', ED_A)
    expect(verdict(contents, { host: 'b.example.com', key: ED_A })).toBe('match')
  })

  describe('ports', () => {
    it('matches the bracketed form on its port', () => {
      expect(verdict(line('[example.com]:2222', ED_A), { port: 2222, key: ED_A })).toBe('match')
    })

    it('does not apply a bracketed entry to the default port', () => {
      expect(verdict(line('[example.com]:2222', ED_A), { key: ED_A })).toBe('unknown')
    })

    it('falls back to a bare line when off-port', () => {
      expect(verdict(line('example.com', ED_A), { port: 2222, key: ED_A })).toBe('match')
    })

    // The fallback pass is advisory: OpenSSH downgrades a wrong key there to "not known".
    it('never reports a change from the fallback pass', () => {
      expect(verdict(line('example.com', ED_B), { port: 2222, key: ED_A })).toBe('unknown')
    })

    it('lets the bracketed pass decide when both forms exist', () => {
      const contents = `${line('[example.com]:2222', ED_B)}\n${line('example.com', ED_A)}`
      expect(verdict(contents, { port: 2222, key: ED_A })).toBe('mismatch')
    })
  })

  describe('patterns', () => {
    it.each([
      ['a star glob', line('*.example.com', ED_A), 'host.example.com', 'match'],
      ['a non-matching glob', line('*.example.com', ED_A), 'host.other.com', 'unknown'],
      ['a question-mark glob', line('host?.example.com', ED_A), 'host1.example.com', 'match']
    ])('handles %s', (_label, contents, host, expected) => {
      expect(verdict(contents, { host, key: ED_A })).toBe(expected)
    })

    it('lets one negation veto the whole line', () => {
      const contents = line('*.example.com,!secret.example.com', ED_A)
      expect(verdict(contents, { host: 'secret.example.com', key: ED_A })).toBe('unknown')
      expect(verdict(contents, { host: 'public.example.com', key: ED_A })).toBe('match')
    })
  })

  describe('hashed entries', () => {
    it('matches a hashed host', () => {
      expect(verdict(`${HASHED_EXAMPLE_COM} ssh-ed25519 ${ED_A}`, { key: ED_A })).toBe('match')
    })

    it('reports a change against a hashed host', () => {
      expect(verdict(`${HASHED_EXAMPLE_COM} ssh-ed25519 ${ED_A}`, { key: ED_B })).toBe('mismatch')
    })

    it('does not match a different host', () => {
      const contents = `${HASHED_EXAMPLE_COM} ssh-ed25519 ${ED_A}`
      expect(verdict(contents, { host: 'other.com', key: ED_A })).toBe('unknown')
    })

    // The bracketed string itself is hashed, so each candidate form must be hashed separately.
    it('matches a hashed bracketed entry on its port', () => {
      const contents = `${HASHED_EXAMPLE_COM_2222} ssh-ed25519 ${ED_A}`
      expect(verdict(contents, { port: 2222, key: ED_A })).toBe('match')
    })
  })

  describe('markers', () => {
    const revoked = `@revoked ${line('example.com', ED_A)}`

    it.each([
      ['listed after the good line', `${line('example.com', ED_A)}\n${revoked}`],
      ['listed before it', `${revoked}\n${line('example.com', ED_A)}`]
    ])('reports revoked when %s', (_label, contents) => {
      expect(verdict(contents, { key: ED_A })).toBe('revoked')
    })

    it('still reports a change for a different key on a revoked host', () => {
      expect(verdict(`${line('example.com', ED_A)}\n${revoked}`, { key: ED_B })).toBe('mismatch')
    })

    it('treats a cert-authority-only host as unsupported rather than first contact', () => {
      const contents = `@cert-authority ${line('*.example.com', ED_A)}`
      expect(verdict(contents, { host: 'host.example.com', key: ED_B })).toBe('ca-only')
    })

    it('lets a plain line decide alongside a cert-authority line', () => {
      const contents = `@cert-authority ${line('*.example.com', ED_A)}\n${line('host.example.com', ED_B)}`
      expect(verdict(contents, { host: 'host.example.com', key: ED_B })).toBe('match')
    })

    it('skips a line carrying an unrecognised marker', () => {
      expect(verdict(`@bogus ${line('example.com', ED_A)}`, { key: ED_A })).toBe('unknown')
    })
  })

  describe('key types', () => {
    // The distinction the whole design rests on: a host we know by another type is NOT first
    // contact, or an attacker who cannot forge the known type just presents a different one.
    it('does not report a change when only another key type is on file', () => {
      const contents = line('example.com', RSA_A, 'ssh-rsa')
      expect(verdict(contents, { key: ED_A })).toBe('unknown-type-known-host')
    })

    it('matches within the same type', () => {
      const contents = line('example.com', RSA_A, 'ssh-rsa')
      expect(verdict(contents, { key: RSA_A })).toBe('match')
    })
  })

  describe('file shape', () => {
    it('accepts CRLF terminators', () => {
      expect(verdict(`${line('example.com', ED_A)}\r\n`, { key: ED_A })).toBe('match')
    })

    it('skips blanks, comments and surrounding whitespace', () => {
      const contents = `\n# comment\n   \n   ${line('example.com', ED_A)}   \n`
      expect(verdict(contents, { key: ED_A })).toBe('match')
    })

    // Files are unioned by the caller: any exact hit wins, and disagreement elsewhere is not a
    // change. Both orderings verified live.
    it.each([
      ['user file first', `${line('h', ED_A)}\n${line('h', ED_B)}`],
      ['global file first', `${line('h', ED_B)}\n${line('h', ED_A)}`]
    ])('accepts a hit regardless of which file holds it (%s)', (_label, contents) => {
      expect(verdict(contents, { host: 'h', key: ED_A })).toBe('match')
    })
  })
})
