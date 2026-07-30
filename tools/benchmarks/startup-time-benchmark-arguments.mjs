export function parseStartupBenchmarkArgs(argv) {
  const args = {
    label: 'run',
    iterations: 5,
    files: 28000,
    fixtureDir: null,
    exe: null,
    timeoutMs: 240000,
    stateProfile: 'none',
    sessionTabs: 0,
    githubRepos: 0,
    ghHangMs: 0,
    waitForEvent: 'did-finish-load',
    // Keeps new-build trailing milestones observable after the baseline-compatible boundary.
    lingerMs: 500
  }
  for (let i = 2; i < argv.length; i++) {
    const next = () => argv[++i]
    switch (argv[i]) {
      case '--label':
        args.label = next()
        break
      case '--iterations':
        args.iterations = Number(next())
        break
      case '--files':
        args.files = Number(next())
        break
      case '--fixture-dir':
        args.fixtureDir = next()
        break
      case '--exe':
        args.exe = next()
        break
      case '--timeout-ms':
        args.timeoutMs = Number(next())
        break
      case '--state-profile':
        args.stateProfile = next()
        break
      case '--session-tabs':
        args.sessionTabs = Number(next())
        break
      case '--github-repos':
        args.githubRepos = Number(next())
        break
      case '--gh-hang-ms':
        args.ghHangMs = Number(next())
        break
      case '--wait-for-event':
        args.waitForEvent = next()
        break
      case '--linger-ms':
        args.lingerMs = Number(next())
        break
      default:
        throw new Error(`Unknown argument: ${argv[i]}`)
    }
  }
  return args
}
