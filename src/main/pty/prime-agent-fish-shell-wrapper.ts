import { wslHookRelayEndpointFilePath } from '../../shared/wsl-hook-relay-contract'
import { PRIME_AGENT_SUBCOMMANDS } from './prime-agent-shell-wrapper'

/** Fish-syntax twin of `getPosixPrimeAgentShellWrapper()`.
 *
 *  Why a separate generator: fish is not POSIX — no `local`, no `case/esac`, no
 *  `shift`, no `${var:-}` — so the bash wrapper is a parse error under fish and
 *  a fish login shell silently loses Prime status reporting (STA-3927). Every
 *  argv semantic below must stay in lockstep with the bash wrapper; the two
 *  test files assert the same matrix. */
export function getFishPrimeAgentShellWrapper(): string {
  // Why fish-expression operands: the shared contract builds the path, but the
  // interpolated pieces must be fish variable syntax, not `${HOME%/}`.
  const guestEndpointPath = wslHookRelayEndpointFilePath(
    '$__orca_prime_home',
    '$ORCA_WSL_HOOK_INSTANCE'
  )
  return `# Why: WSL cannot install into Prime's guest-owned config root from the
# Windows host, so pass Orca's status extension only to interactive launches.
if test -n "$ORCA_PRIME_AGENT_STATUS_EXTENSION"
  function __orca_prime_agent_should_skip_extension
    if test "$argv[1]" = "--daemon-socket"
      if test "$argv[3]" = "stop"; or test "$argv[3]" = "rename"
        return 0
      end
    end
    # Why quoted: an unquoted glob with no match is a hard error in fish.
    if string match -q -- "--daemon-socket=*" "$argv[1]"
      if test "$argv[2]" = "stop"; or test "$argv[2]" = "rename"
        return 0
      end
    end
    switch "$argv[1]"
      case help --help -h --version -v --extension "--extension=*"
        return 0
      case ${PRIME_AGENT_SUBCOMMANDS.join(' ')}
        return 0
    end
    return 1
  end
  function __orca_prime_agent_has_explicit_extension
    for __orca_arg in $argv
      switch "$__orca_arg"
        case --extension "--extension=*"
          return 0
      end
    end
    return 1
  end
  function __orca_prime_agent_launch
    if test "$argv[1]" = "attach"; and test -n "$argv[2]"; and not string match -q -- "-*" "$argv[2]"
      set -l __orca_attach_agent $argv[2]
      set -e argv[1..2]
      command prime-agent attach $__orca_attach_agent --extension "$ORCA_PRIME_AGENT_STATUS_EXTENSION" $argv
    else
      command prime-agent --extension "$ORCA_PRIME_AGENT_STATUS_EXTENSION" $argv
    end
  end
  function __orca_prime_agent
    if test "$argv[1]" = "attach"; and begin; test -z "$argv[2]"; or string match -q -- "-*" "$argv[2]"; end
      command prime-agent $argv
      return
    end
    if not __orca_prime_agent_should_skip_extension $argv; and not __orca_prime_agent_has_explicit_extension $argv; and test -f "$ORCA_PRIME_AGENT_STATUS_EXTENSION"
      set -l __orca_prime_home (string trim -r -c / -- "$HOME")
      # Why the duplicated launch: fish scopes \`set -lx\` to the enclosing block,
      # not the function, so the export must wrap the launch it applies to.
      if test -n "$HOME"; and test -n "$ORCA_WSL_HOOK_INSTANCE"
        set -lx ORCA_AGENT_HOOK_ENDPOINT "${guestEndpointPath}"
        __orca_prime_agent_launch $argv
        return
      end
      __orca_prime_agent_launch $argv
      return
    end
    command prime-agent $argv
  end
  function prime-agent
    __orca_prime_agent $argv
  end
end
`
}
