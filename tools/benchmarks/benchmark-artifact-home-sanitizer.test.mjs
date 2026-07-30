import { describe, expect, it } from 'vitest'
import { sanitizeBenchmarkArtifactHomePaths } from './benchmark-artifact-home-sanitizer.mjs'

describe('sanitizeBenchmarkArtifactHomePaths', () => {
  it('sanitizes nested macOS and Linux home paths without mutating input', () => {
    const artifact = {
      fixtureDir: '/Users/alice/orca fixture',
      iterations: [
        {
          events: [
            {
              details: {
                argv: [
                  '/Users/alice/Applications/Orca.app/Contents/MacOS/Orca',
                  '--profile=/Users/alice/Library/Application Support/Orca'
                ],
                nested: {
                  stack: 'at launch (file:///Users/alice/project/main.js:1:1)',
                  linuxPath: '/home/builder/project'
                }
              }
            }
          ]
        }
      ],
      untouched: {
        outsideHome: '/Users/bob/project',
        prefixCollision: '/Users/alice-other/project',
        count: 4,
        enabled: true,
        missing: null
      }
    }

    const sanitized = sanitizeBenchmarkArtifactHomePaths(artifact, '/Users/alice')

    expect(sanitized).toEqual({
      fixtureDir: '~/orca fixture',
      iterations: [
        {
          events: [
            {
              details: {
                argv: [
                  '~/Applications/Orca.app/Contents/MacOS/Orca',
                  '--profile=~/Library/Application Support/Orca'
                ],
                nested: {
                  stack: 'at launch (file://~/project/main.js:1:1)',
                  linuxPath: '/home/builder/project'
                }
              }
            }
          ]
        }
      ],
      untouched: {
        outsideHome: '/Users/bob/project',
        prefixCollision: '/Users/alice-other/project',
        count: 4,
        enabled: true,
        missing: null
      }
    })
    expect(artifact.fixtureDir).toBe('/Users/alice/orca fixture')
    expect(artifact.iterations[0].events[0].details.argv[0]).toContain('/Users/alice')
  })

  it('sanitizes a Linux-shaped home embedded in arrays and messages', () => {
    expect(
      sanitizeBenchmarkArtifactHomePaths(
        {
          values: [
            '/home/alice',
            'execPath=/home/alice/bin/orca',
            'outside=/opt/orca',
            '/home/alice2/project'
          ]
        },
        '/home/alice/'
      )
    ).toEqual({
      values: ['~', 'execPath=~/bin/orca', 'outside=/opt/orca', '/home/alice2/project']
    })
  })

  it('sanitizes Windows-shaped homes with either separator and path casing', () => {
    expect(
      sanitizeBenchmarkArtifactHomePaths(
        {
          execPath: 'C:\\Users\\ALICE\\AppData\\Local\\Orca\\Orca.exe',
          argv: [
            '--user-data-dir=C:/Users/Alice/App Data/Orca',
            'file:///C:/Users/Alice/project/index.js',
            'D:\\Users\\Alice\\outside.exe',
            'C:\\Users\\Alice-old\\outside.exe'
          ]
        },
        'C:\\Users\\Alice'
      )
    ).toEqual({
      execPath: '~\\AppData\\Local\\Orca\\Orca.exe',
      argv: [
        '--user-data-dir=~/App Data/Orca',
        'file:///~/project/index.js',
        'D:\\Users\\Alice\\outside.exe',
        'C:\\Users\\Alice-old\\outside.exe'
      ]
    })
  })

  it.each(['/', 'C:\\', 'D:/'])('leaves paths unchanged for filesystem-root home %s', (home) => {
    const artifact = {
      posixPath: '/opt/orca/bin/orca',
      windowsPath: 'C:\\Program Files\\Orca\\Orca.exe',
      url: 'https://example.com/assets/app.js',
      nested: ['file:///usr/local/orca', { path: 'D:/Orca/orca.exe' }]
    }

    expect(sanitizeBenchmarkArtifactHomePaths(artifact, home)).toEqual(artifact)
  })
})
