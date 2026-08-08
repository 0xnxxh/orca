# Terminal session authority delivery ledger

This ledger tracks implementation of
[`terminal-session-authority.md`](./terminal-session-authority.md). A goalpost is
complete only when its production path and its named proof both exist. Focused
unit tests, typechecking, or the presence of scaffolding cannot prove a broader
goalpost.

Status values are `not started`, `partial`, and `proven`. Update the evidence
column with exact tests or runtime journeys before changing a row to `proven`.

## Numeric checkpoint

The final pause snapshot must retain this release classification:

- goalposts: **0/8 proven, 6/8 partial, 2/8 not started**;
- partial: G0, G1, G2, G3, G4, and G6;
- not started: G5 and G7;
- required journeys: **0/13 proven**.

Host-authority and E2EE-storage acceptance is recorded separately as a
construction milestone. It cannot promote one of these rows or journeys.

## Goalposts

| ID  | Goalpost                        | Completion evidence                                                                                                                                                                                                                                                   | Status      | Current evidence or gap                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                  |
| --- | ------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| G0  | One design contract             | Every production path follows the identity, host-boundary, migration, compatibility, and minimal-shape sections of the design                                                                                                                                         | partial     | The contract now states host-local identity, host-derived principals, exact challenge/CAS admission, and final-host cursors. Current code still contains duplicated exact-operation clients, validation, transport-specific topology/retry state, and reachable legacy/authority paths, so the production graph does not yet match the four-role design. No audit entry below is runtime proof.                                                                                                                          |
| G1  | One final-host authority        | Local, daemon, WSL, direct SSH, nested SSH, paired runtime, and remote server all resolve one final-host namespace and exact binding                                                                                                                                  | partial     | The host pause tranche independently accepted proof-derived daemon and SSH transports, namespace-local admission, exact reconnect, cumulative ACK, and authenticated retirement with P0/P1/P2=0. That acceptance is construction evidence only: complete local/WSL/paired/remote and simultaneous multi-host production journeys, reset orchestration, and post-cutover legacy removal remain unproven.                                                                                                                  |
| G2  | Exact operations only           | Input, resize, signal, close, output, and exit are fenced by the captured full binding; stale or missing evidence cannot affect a successor                                                                                                                           | partial     | The accepted host tranche covers exact close rejection, failed and partial stop, disconnected replay, and replacement-while-stop-awaits; the final pause receipts include 466 PTY tests, 168 adjacent tests, and 7 exact-close cases. This does not yet prove every input, resize, signal, close, output, and exit path across local, daemon, WSL, SSH, paired, remote, mobile, renderer fallback, and mixed versions.                                                                                                   |
| G3  | Durable ordered delivery        | Snapshot-before-events, held producer pause, replay-before-resume, durable semantic outcomes, durable idempotent main-process app projection, cumulative final-host ACK, renderer snapshot/delta observation, restart resume, and gap resnapshot are production-wired | partial     | The accepted host tranche covers independent host/app consumers, proof-derived transports, namespace admission, reconnect, cumulative ACK, and retirement. The app delivery cursor, per-outcome settlement/tombstone path, duplicate proof-key store, and receipt ledger are deleted. Fresh broad validation passed, but full restart, gap, paired/remote, mixed-version, and crash-before-ACK journeys remain unproven, so pause acceptance does not promote G3.                                                        |
| G4  | One-way legacy cutover          | Capability, freeze, exact inventory, plan, validation, one self-contained authority commit, topology attach, and `pty.openClient` run in order without dual-write or destructive inference                                                                            | partial     | Planner, evidence bridge, relay worker primitives, and a pre-admission barrier exist. Self-contained namespace import records now replay without the separate catalog in focused construction tests, but broader validation, production topology attach, and removal of legacy dual-write remain incomplete.                                                                                                                                                                                                             |
| G5  | Wire and platform compatibility | Both version-skew directions and native macOS, Linux, Windows, WSL, Docker SSH, daemon, paired, remote, folder, floating, and worktree journeys pass                                                                                                                  | not started | No production journey is proven. Focused current/old terminal-wire tests pass 4/4 and the accepted host tranche covers fail-closed proof/grant behavior in its owned daemon/SSH scope, but live skew across SSH, paired runtime, remote server, and mobile/E2EE surfaces is absent. Native Windows, WSL, glibc-floor Linux, two-host, folder/floating/UNC, and production-scale coverage also remain absent.                                                                                                             |
| G6  | Simpler production code         | No unreachable non-test modules, test fixtures in production trees, duplicate state machines, re-export shims, or legacy reconciliation reachable after cutover                                                                                                       | partial     | Completed deletion passes removed 3,609 production LOC, 1,980 gross legacy-catalog LOC, 1,861 app-ledger LOC, and 97 test-only seam LOC, while moving 891 fixture LOC out of production. The 2026-08-07 pre-documentation census is still net +60,903 production LOC across 522 files because replacement authority, transport, migration, and legacy paths coexist. Reachability, duplicate-state-machine, one-type-module, and post-cutover deletion audits remain mandatory; the target remains net at or below zero. |
| G7  | No regression and reviewable PR | Correctness, latency, throughput, memory, restore, scale, packaging, independent review, readiness review, and final LOC census pass                                                                                                                                  | not started | The narrower pause validation is independently clean, including the repaired 829-file/8,831-test broad run, but the 13 release journeys, real-platform and production-scale proof, convergence/deletion, rebase, final release review, commit, push, and PR do not exist.                                                                                                                                                                                                                                                |

## Correctness gates

- Missing transport, timeout, failed inspection, absent projection, and unknown
  process state never authorize exit, cleanup, takeover, or replacement.
- Ambiguous, unavailable, or rejected attach never falls back to spawning a
  shell; creation requires an explicit fresh pane generation.
- Every mutation target is captured before an await and includes authority host,
  namespace, pane generation, owner incarnation, physical PTY, and PTY
  incarnation.
- An authoritative path never invokes an ID-only provider method or retries an
  exact rejection through the legacy path.
- The final PTY-owning host appends mutation results and semantic outcomes before
  publication; a consumer ACK happens only after its handler settles.
- Authority checkpoints and first-claim boundaries carry complete bounded
  app-neutral semantic state with event identities; journal compaction cannot
  make a new consumer lose title, agent, command, bell, review-link, or exit state.
- Host connection state is keyed by `authorityHostId`; it is lazily discovered,
  permits concurrent hosts, and retains no fabricated state for a skipped host.
  `NamespaceSession`, admission, grant, failure, and retirement state are each
  keyed by `authorityHostId + namespaceId`.
- One bounded stable app/device proof-of-possession identity is shared across
  host connections. Its process/session nonce is fresh and ephemeral. The host
  derives the consumer principal from the authenticated proof and
  `authorityHostId`; a host-wide SSH endpoint credential or client-supplied
  profile ID cannot identify that principal.
- The host-issued challenge is bound to `authorityHostId`, `namespaceId`, the
  current CAS (`currentCas`), the candidate process/session nonce, `requestId`, and
  the exact connection grant. Proof requirements are mechanism-neutral and must
  provide fresh, domain-separated possession, replay, cross-host, and
  cross-namespace binding. Prefer the durable E2EE keypair only if such a
  domain-separated proof satisfies the requirements; otherwise use a dedicated
  signing key, with no silent weakening.
- First-install provisioning creates the proof identity once. Established
  missing, corrupt, noncanonical, or public/private-mismatched identity state
  fails closed; explicit reset/re-enrollment revokes the old identity and moves
  its establishment evidence with paired-device credentials.
- The establishment marker contains a stable random installation identity, and
  the current keypair schema contains the same identity. Only the validated
  pre-marker keypair schema may migrate without a marker. Migration durably
  stages the exact legacy key material in the current schema before publishing
  the marker, then promotes that exact stage; every stage, marker, active-file,
  and replacement-backup crash cut reuses the same key. A current-schema keypair
  with no marker fails closed. First install and reset publish a bounded
  non-active staged keypair through one atomic active-file rename, while reset
  leaves the installation marker unchanged.
- Canonical user-data reconciliation compares validated installation, key, and
  reset-stage lineage rather than raw JSON or mutable registry/outbox bytes.
  Equivalent lineage no-ops even after mutable lifecycle drift; key,
  installation, or reset-transaction divergence fails closed.
- A stage declares first-install or reset purpose; reset stages bind the exact
  transaction ID. The ordinary loader can finish only first install with no
  active keypair. It never promotes a reset stage, and recovery never generates
  a second key after either kind of stage is durable. The exact reset stage
  remains after publication until a later durable phase in the sole reset
  transaction verifies and removes it; no successor-only, activation,
  publication, or receipt ledger exists.
- Identity-lifecycle writes that advance a crash boundary explicitly sync the
  file before rename and the containing directory afterward where supported.
  Real POSIX sync failures propagate, unsupported platform/filesystem behavior
  is explicit, and ordinary secure-file writes retain their rename-only cost.
- Identity reset persists one bounded phase/target-intent record before
  mutation, then requires all final-host retirements, relay revoke
  acknowledgements, transport closure, and local credential removal in that
  order before successor publication. It stores the old proof-key public
  fingerprint, not a global consumer ID, and derives each host-local principal
  from `authorityHostId`. It stores no per-target receipt; restart reissues
  idempotent work against the host journal and relay outbox. Old revoke and
  host-removal APIs cannot bypass this transaction or infer success from a
  disconnect.
- A lost retirement response retries the exact result on its live connection.
  After host restart, a fresh retirement-specific proof may confirm the derived
  principal is already absent without re-claiming it. Ordinary inventory
  absence, disconnect, or a false legacy cancellation result is not an
  acknowledgement, and no durable transport-grant or retirement-receipt ledger
  is added.
- Consumer claim, handover, ACK, and retirement resolve through that exact
  authenticated grant and nonce, never a consumer label alone. Partial setup
  removes every claim, handler, observer, and grant it added. A changed or
  stale challenge fails closed.
- Exact retry idempotence applies to the canonical challenge/proof/request and
  `requestId` for one host, namespace, and grant: an uncertain response retries
  that exact request and returns its original result. A host-current snapshot is
  never blindly adopted, and no app-global committed/pending predecessor pair
  is used to infer ownership.
- After boundary acceptance, the final host durably commits the policy claim and
  cursor, then installs the connection-bound grant and exact-retry result in the
  same serialized operation before returning success. A socket-write callback
  cannot authorize or roll back it. Same-connection uncertainty retries exactly;
  restart uses a fresh authenticated resume without a durable grant ledger.
- The final host attests first claim versus CAS-fenced handover independently for
  each namespace. The namespace is the admission transaction: a multiplexed
  connection never performs a best-effort batch that partially rotates durable
  ownership; failure retains that namespace's incumbent and cannot invalidate
  another completed namespace grant or install a global failure fence.
- A process crash before the durable claim append preserves the incumbent, while
  a crash after it leaves the claim and cursor recoverable through authenticated
  resume. In-memory rollback after an earlier durable claim is not sufficient.
- For a first claim, the host holds the producer and publishes the complete
  boundary before the claim. The app commits and explicitly accepts that exact
  boundary; transport send/flush success cannot substitute for acceptance. An
  uncertain failure leaves the incumbent unchanged and retries the exact
  challenge/proof/request without a boundary ledger.
- A high-water boundary snapshot is staged while a returning consumer replays
  its contiguous suffix, then reconciled before the high-water ACK. This
  replay-before-reconciliation order is not optional. The snapshot is applied
  immediately only for a host-attested caught-up first claim.
- The app has no delivery cursor, settlement ledger, receipt ledger, or global
  failure fence. The final host owns cumulative cursors; app projection event
  keys may make projection application idempotent but cannot authorize a host
  ACK by themselves.
- Every correctness-bearing app handler is idempotent by authority event key or
  durably commits its projection before cumulative host ACK; an arbitrary
  callback, renderer delivery, or IPC send followed by ACK is not accepted as
  exactly-once evidence.
- Process-memory deduplication cannot prove app-crash replay safety and never
  authorizes a cumulative host ACK.
- Reconnect drains replay while the producer remains explicitly held. Send
  failure, disconnect, overflow, restart, and gap all preserve recoverability or
  fail closed.
- Producer holds are keyed by `authorityHostId + namespaceId`. Acquisition and
  producer queue admission are linearizable; a producer cannot pass the gate
  before that namespace's hold and append inside its snapshot.
- Disconnect and reconnect fence generation-owned queues before installing a
  successor. A non-settling ACK cannot block the successor, reconnect retries
  automatically under bounded-resource backoff, and I/O timeout never implies
  ACK, exit, or liveness.
- One exact host/namespace/binding has one active source delivery lease. Its
  token plus provider, client, and owner generations fence every span, credit
  ACK, replay, cancellation, pause, and exit. A provisional replacement cannot
  publish, ACK, or mutate; promotion fences the predecessor and its queued bytes
  before the replacement becomes active, without affecting sibling namespaces.
- The bounded byte/scalar-unit credit window is flow control only. Exhaustion
  bounds retained output and pauses the exact active delivery; elapsed time,
  window occupancy, or retry count never decides identity, liveness, takeover,
  quarantine, or replacement.
- Backlog delivery uses bounded contiguous pages so a durable projection does not
  require one full-sync transaction and transport round trip per historical
  outcome; page commit and cumulative ACK preserve exact order and replay safety.
- Page-aware delivery is part of the first shipped namespace-cursor capability;
  origin peers that lack it never receive those publications in either
  version-skew direction.
- Migration is read-only until one atomic cutover commit. Ambiguous evidence is
  visible and non-destructive; no timeout or retry count resolves identity.
- Post-cutover unresolved recovery rows fence only the exact identities they name;
  they neither authorize cleanup nor freeze unrelated namespace operations.
- Sandboxed preload safety is enforced against emitted bundles in
  `generateBundle` before output writes. Every preload chunk and the targeted
  `browser-window-close-preload` entry permits only the exact `electron`
  external; bare/static or dynamic imports, helper chunks, and literal, renamed,
  or non-literal `require` forms fail closed. Ordinary main chunks are outside
  this sandbox boundary.

## Required journeys

| Journey                                                   | Required oracle                                                                                                                                                              | Status     | Current evidence or gap                                                                                                                                      |
| --------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Local macOS, Linux, and Windows                           | Same pane/binding/process across renderer and app restart; stale exact operations rejected                                                                                   | not proven | Focused macOS-host tests exist; no complete live local restart journey on all three operating systems.                                                       |
| Daemon and WSL                                            | Same PTY across client and daemon reconnect/restart boundaries; generation skew fails closed                                                                                 | not proven | Daemon seams and reconnect races have focused coverage; no physical WSL or full daemon-restart journey.                                                      |
| Lazy discovery and skipped-host restart                   | An unused host is not probed eagerly; after a restart that skipped it, lazy rediscovery restores only that host's sessions without adopting host-current state               | not proven | Host/namespace isolation has deterministic construction tests; no full skipped-host restart with lazy rediscovery.                                           |
| Concurrent multi-host connections                         | Two or more `HostConnection`s keyed by distinct `authorityHostId`s operate concurrently; one host's disconnect, CAS, or failure cannot affect another                        | not proven | Host-keyed state and sibling isolation have focused tests; no simultaneous live multi-host journey.                                                          |
| Namespace-partial admission failure                       | One namespace on a multiplexed connection fails challenge/CAS or grant publication while another commits; only the failed `authorityHostId + namespaceId` is fenced          | not proven | Namespace admission and sibling-failure races have focused tests; no complete multiplexed production journey.                                                |
| Docker OpenSSH with `MaxSessions=1`                       | Same remote PID and exact binding across disconnect and client restart; authority restart imports exactly or exposes unresolved recovery without destruction                 | not proven | Single-host Docker journeys cover reconnect, contention, rejection, and app relaunch; this is pause evidence, not the full release oracle.                   |
| Two independent Docker SSH hosts                          | Two Docker hosts with distinct `authorityHostId`s run simultaneously; endpoint credentials, principals, sessions, cursors, and failures never cross-contaminate              | not proven | Not run.                                                                                                                                                     |
| Paired client and remote server                           | Final host remains authoritative across independent client/host updates, pairing reconnects, and remote-runtime restart                                                      | not proven | Wire and storage seams have focused tests; no live paired-runtime or remote-server restart journey.                                                          |
| Git worktree, folder, floating, drive, and UNC namespaces | Stable host-local namespace with no client repository ID or target ID used as identity                                                                                       | not proven | Pure locator tests cover POSIX, drive, UNC, folder, and floating shapes; real drive/UNC and complete workspace journeys are absent.                          |
| Stable proof and exact retry                              | One bounded app/device proof identity admits fresh process/session nonces; lost challenge responses retry exactly, while altered or host-current state is rejected           | not proven | Proof, CAS, retry, disconnect, and retirement tests exist; no complete cross-platform app/device journey.                                                    |
| Identity reset and re-enrollment                          | Crash-resumable host retirement, relay acknowledgement, transport closure, local deletion, and atomic successor publication occur in order; offline/old peers remain pending | not proven | The E2EE storage lifecycle is pause-accepted; the ordered multi-host reset and re-enrollment transaction is not implemented.                                 |
| Mixed versions in both directions                         | No unknown opcode or ungranted topology publication; unsupported challenge/grant or mutations remain isolated legacy or fail before mutation                                 | not proven | In-process old-client/new-host and new-client/old-host wire tests exist; live paired/SSH skew and all exchanged surfaces remain unproved.                    |
| Performance and scale                                     | No regression in input/output latency, backpressure, memory, restore, startup, or large-pane behavior                                                                        | not proven | A bounded 25,000-operation hot-path gate checks writes, queues, heap, and timing; no production-scale cross-platform baseline or full interaction benchmark. |

## Reduction ledger

Production-line count is measured against the eventual PR base and reported
separately from tests and CI. Net-negative production code is preferred because
the authority replaces reconciliation systems; correctness is never weakened to
hit the number. The final target is net production LOC at or below zero after
rebasing; any positive remainder requires an explicit retained-module and
superseded-path audit rather than a generic “new architecture” justification.
Construction snapshots use `--no-renames` against the current branch base; the
final census is repeated after rebasing onto the PR base.

Current reduction targets:

- remove unreachable non-test modules and unused public seams;
- move test-only fixtures out of production compilation;
- merge one-type and type-only files into their owning domain modules;
- use one authority transition/validation implementation;
- use one exact-operation client and one mutation-admission implementation;
- replace singleton host transport/admission state with one `HostConnection`
  keyed by `authorityHostId` and one `NamespaceSession` family keyed by
  `authorityHostId + namespaceId`;
- remove app-global committed/pending predecessor transitions and client-supplied
  consumer identity; retain only one bounded stable app/device proof identity,
  host-derived principals, and ephemeral process/session/request state;
- remove host-current adoption, retry-count identity decisions, and any
  process-wide failure fence; failures and retirement remain namespace-local;
- share the daemon and relay bounded-output machinery;
- delete the relay per-outcome pending map and app-side SSH outcome-receipt
  staging once authenticated namespace cursors carry exit and semantic outcomes;
- delete the app-side delivery cursor, per-outcome settlement/tombstone store,
  receipt ledger, and suffix reconciliation; persist only the bounded proof
  identity and use the final-host cumulative cursor plus idempotent app
  projection replay;
- remove client-generation and owner-grace outcome ownership from authoritative
  delivery once host-derived principals and final-host cursors replace it;
  retain those mechanisms only in the unchanged legacy session path;
- delete legacy lease/layout dual-writes and reconnect reconciliation once G4 is
  production-wired;
- remove the elapsed-time terminal-input quarantine from authoritative renderer
  recovery; unchanged legacy recovery may retain it only before cutover;
- delete the separate legacy cutover catalog, receipt-reference events, and
  suffix reconciliation after the importer commits self-contained namespace
  records directly to the authority journal;
- delete timing windows, quarantine verdicts, retry-count identity decisions,
  and parallel renderer readiness state replaced by authority facts.

Next evidence-backed consolidation seeds, not yet counted as completed
deletions:

- move the test-only SSH fixtures
  `ssh-pty-consumer-session-grant-fixture.ts`,
  `ssh-terminal-authority-process-fixture.ts`,
  `ssh-relay-native-deps-install-fixture.ts`, and
  `ssh-relay-session-test-fixtures.ts` out of the production source tree; a
  direct import scan finds only test importers;
- keep one E2EE key-material equality implementation instead of the identical
  exported `sameKeyMaterial` definitions in
  `e2ee-keypair-backup-lineage.ts` and `e2ee-keypair-successor.ts`;
- keep one authority-namespace equality implementation instead of repeating
  the same host-ID/namespace-ID comparison across app outcome, projection,
  legacy inventory/state/transition, record validation, and subscription
  registry modules;
- extract shared daemon/SSH admission and delivery transitions only where their
  current production callers and parity tests prove identical semantics;
  transport connection and encoding mechanics remain in thin adapters.

Working consolidation budget (a forcing function, never permission to weaken a
correctness gate):

| Retained responsibility                                    | Gross new production target |
| ---------------------------------------------------------- | --------------------------: |
| Authority identity, transition, persistence, outcomes      |                <= 5,000 LOC |
| Exact-operation and local/daemon/SSH/relay/paired adapters |                <= 3,500 LOC |
| One bounded legacy importer and physical-worker adoption   |                <= 4,000 LOC |
| Durable app projection and renderer observation controller |                <= 2,000 LOC |
| Capability negotiation and compatibility isolation         |                <= 1,000 LOC |
| **Total retained new production**                          |           **<= 15,500 LOC** |

The matching deletion floor is at least 15,500 production LOC from the replaced
exact-operation, direct-SSH reconnect/hydration/retry, lease/receipt, renderer
reconciliation/quarantine, and transport-specific state-machine paths. Any
budget overrun requires a file-by-file responsibility and superseded-path ledger;
"architecture" or "compatibility" alone is not a justification.

Completed construction-tree reductions:

- removed the in-memory pending-close registry and polling replay state machine;
  persisted full-binding close intent now enters the shared SSH termination path.
- removed 29 rootless or superseded production modules (3,609 LOC), including a
  renderer authority island that derived ownership from Redux and duplicate
  eager-delivery machinery;
- removed 1,980 gross production LOC of separate legacy-cutover catalog state,
  store, record, registry, and service code; namespace journal events now carry
  complete import and acknowledgement evidence;
- removed 10 app delivery-cursor, settlement/tombstone, receipt-ledger, and
  duplicate proof-key modules (1,861 LOC); the retained app projection is
  event-keyed and does not own an authority cursor;
- removed 97 production LOC of registry adapters, in-memory stores, validators,
  and accepted-write APIs that had only test callers; equivalent fixtures stay
  in tests when they still prove live production behavior;
- moved five test-only fixtures (891 LOC) from production compilation into
  explicit `__tests__` directories and removed 4,038 LOC of tests that only
  exercised the deleted systems.

Pause-documentation census against
`a7ffb244e45fee0cb75a129aaa726ce7a2f68845`, using
`git diff --numstat --no-renames` plus full line counts for untracked files:

| Category   | Files | Additions | Deletions |     Net |
| ---------- | ----: | --------: | --------: | ------: |
| Production |   522 |    65,357 |     4,454 | +60,903 |
| Tests      |   268 |    45,936 |     2,995 | +42,941 |
| Docs       |     3 |     1,361 |         0 |  +1,361 |
| CI/config  |     8 |       382 |         3 |    +379 |

The expanded status has 801 paths: 255 tracked entries including 10 deletions,
plus 546 untracked files. HEAD remains the construction base. At
2026-08-07T22:04:56Z, `origin/main` was
`2396e5e3e583a9dd8d237602372e5b66a780e6ac`, with branch distance 0 ahead and
51 behind. No commit, push, rebase, stash mutation, or PR action occurred
during pause closure.

The increased production count reflects concurrent construction before the
required app-ledger, duplicate exact-operation, legacy relay/SSH, unreachable
file, and compatibility-path deletion passes. It is not an acceptable final PR
size.

The PR cannot open while a new production module has no production importer or
while a legacy source of truth remains reachable after authoritative admission.

## Verification record

Record only commands run against the converged worktree. Earlier focused runs
are useful development evidence but are not final proof.

### Historical construction evidence

The date column below uses the America/Los_Angeles calendar date; embedded ISO
timestamps use UTC. These rows preserve development history only. None promotes
a goalpost, journey, or pause-tranche acceptance status.

| Date       | Scope                                                | Command or artifact                                                                                                                                                                                       | Result                                                                                                                                                                                                                                                                                                                                                                                                                            |
| ---------- | ---------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 2026-08-06 | Baseline                                             | Tracked diff: 214 files, +16,907/-5,548; untracked authority source also present                                                                                                                          | Not reviewable; census and consolidation required                                                                                                                                                                                                                                                                                                                                                                                 |
| 2026-08-06 | Multi-host audit (`task_48dd7af53ff8`)               | Completed audit of host discovery, transport/session keying, restart, concurrent hosts, partial namespace failure, and Docker/paired/remote topologies                                                    | Design corrections incorporated: lazy `HostConnection` by `authorityHostId` and namespace-local session state are required; no runtime journey proof is claimed                                                                                                                                                                                                                                                                   |
| 2026-08-06 | Principal audit (`task_225ba542e4c4`)                | Completed audit of app/device identity, host-derived principal, challenge/CAS binding, exact retry, and cross-host authentication boundaries                                                              | Design corrections incorporated: one bounded proof identity, mechanism-neutral domain-separated proof, and no blind host-state adoption; no security or runtime proof is claimed                                                                                                                                                                                                                                                  |
| 2026-08-06 | Reachability snapshot                                | 256 new non-test source files / 34,612 LOC; 224 runtime, 13 type-only, 19 unreachable                                                                                                                     | G6 remains partial                                                                                                                                                                                                                                                                                                                                                                                                                |
| 2026-08-06 | First reduction pass                                 | Exact import audit; node/web typecheck; 11 focused files/98 tests; format and stale-import scans                                                                                                          | Removed 29 production files/3,609 LOC and 15 obsolete tests/4,038 LOC; one independent worktree-teardown compatibility assertion remains red                                                                                                                                                                                                                                                                                      |
| 2026-08-06 | Durable semantic core                                | 149 authority tests plus 16 daemon/relay outcome tests; focused node typecheck, lint, format, and max-lines                                                                                               | Journal core and explicit consumer retirement pass; production producer/controller wiring remains                                                                                                                                                                                                                                                                                                                                 |
| 2026-08-06 | Host physical effects                                | Five focused files / 44 tests; duplicate-exit stress 5/5; touched lint, format, and diff-check                                                                                                            | Restart replay, exact current/imported shutdown, lost-response/concurrent retry, successor fencing, and duplicate-exit idempotency pass; daemon applier remains unwired                                                                                                                                                                                                                                                           |
| 2026-08-06 | App consumer store                                   | One focused file / 9 tests                                                                                                                                                                                | Construction evidence only for bounded identity/incarnation persistence; app cursor, settlement, and receipt-ledger deletion remains required, so it is not proof of the target design                                                                                                                                                                                                                                            |
| 2026-08-06 | App outcome broker construction                      | Four focused files / 24 tests                                                                                                                                                                             | 11 pass, 13 fail; node typecheck fails only in this mid-refactor slice, so G3 is not production-ready                                                                                                                                                                                                                                                                                                                             |
| 2026-08-06 | Daemon authority negotiation                         | Five focused files / 62 tests; preceding daemon/host durability slice 14 files / 121 tests; touched lint, format, and diff-check                                                                          | Caller-controlled capability, control/stream agreement, disconnect clearing, and fail-closed create admission pass. Capability remains unrequested and unadvertised until app transport and exact host-effect application are production-wired; node typecheck is red only in the concurrent broker refactor.                                                                                                                     |
| 2026-08-06 | Broker durability correction                         | Four focused files / 36 tests; scoped lint, format, and max-lines                                                                                                                                         | Invalid boundaries no longer compact durable settlements before rejection; persistence failure leaves memory and delivery unchanged. The app-side settlement ledger remains a scheduled deletion target, so this is construction evidence only.                                                                                                                                                                                   |
| 2026-08-06 | Self-contained namespace migration                   | Focused migration, service, registry, SSH, relay, and authority suites / 244 tests; CLI/web typechecks, scoped standard/native/type-aware lint, format, max-lines, forbidden-symbol audit, and diff-check | Removed 1,980 gross production LOC of catalog state/store/registry/service code. Namespace journals and checkpoints replay complete import evidence, exact retry, acknowledgement, worker routing, and identity-scoped ambiguity fences without a second catalog. Production topology attach and legacy dual-write deletion remain, so G4 stays partial.                                                                          |
| 2026-08-06 | Renderer subscription lifecycle fence                | Seven broker/store/preload files / 39 tests; scoped typecheck, lint, format, max-lines, and diff-check                                                                                                    | A subscribe admitted before navigation, renderer loss, detach, or failed send cannot resurrect afterward; admitted ACKs and fresh subscriptions still recover. G3 remains partial because durable app projection and final-host transport are not wired.                                                                                                                                                                          |
| 2026-08-06 | Relay authority grace boundary                       | Real relay subprocess plus focused grace/lifecycle suites, 62 tests; targeted lint, format, and max-lines                                                                                                 | Finite grace, detached/no-client time, disconnect, and reconnect do not dispose an authoritative PTY; exact retirement and explicit administrative shutdown still do. The unchanged isolated legacy path retains compatibility grace behavior.                                                                                                                                                                                    |
| 2026-08-06 | App outcome controller boundary                      | Twelve renderer files / 86 tests; web typecheck, scoped default/native/type-aware lint, format, max-lines, and diff-check                                                                                 | Listener-before-snapshot buffering, per-stream ordering, incarnation fencing, async handler settlement, cumulative ACK retry, and canonical duplicate validation pass. Legacy callbacks have no idempotent-projection admission marker and therefore cannot run or ACK; crash-safe projection and host transport remain required.                                                                                                 |
| 2026-08-06 | App cursor and ledger deletion (`task_12f08f0ddc0a`) | 56 app tests, 24 shared transport tests, 3 materialization tests, 29 side-effect tests, node/web typechecks, scoped lint, format, max-lines, reachability, and a bounded 25,000-event benchmark           | Deleted the app delivery cursor, per-outcome settlement/tombstone path, duplicate proof-key store, and receipt ledger: 10 production modules/1,861 LOC removed. The retained app projection is event-keyed rather than a second authority cursor; final-host transport installation remains required.                                                                                                                             |
| 2026-08-06 | Adversarial proof/CAS audit (`task_d5b816fb16ee`)    | Read-only daemon, relay/SSH, proof, CAS, identity, and mixed-version audit; seven focused files / 52 tests                                                                                                | No P0. Five P1 blockers remain: unwired production proof transport, boundary/grant admission deadlock, client-selected mixed-version fallback, success publication before admission commit, and non-transactional policy/admission commit. Replay expiry, scoped challenge capacity, canonical encoding, disconnect cleanup, fail-closed identity loading, and mandatory negotiated SSH grants also require correction and proof. |
| 2026-08-06 | Construction LOC census                              | `git diff --numstat --no-renames HEAD` plus untracked-file line counts at 2026-08-07T05:15:52Z, categorized separately for production and tests                                                           | Production: 444 files, +58,456/-3,600, net +54,856. Tests: 231 files, +37,595/-2,299, net +35,296. This is a transient construction tree, not completion evidence; G6 and the net-nonpositive PR gate remain unproven.                                                                                                                                                                                                            |
| 2026-08-06 | Test-only production seam deletion                   | Production-import search, five focused test files / 30 tests, web typecheck, scoped default/native/type-aware lint, format, max-lines, and diff-check                                                     | Removed 97 production LOC across six exports with only test callers. Test-local fixtures preserve the useful registry/cursor behavior; no production entrypoint or compatibility path changed.                                                                                                                                                                                                                                    |
| 2026-08-06 | Identity marker/reset decision                       | Reset prerequisite audit plus keypair, marker, and canonical-user-data migration review                                                                                                                   | Settled the legacy conflict without a permissive loader: only the pre-marker keypair schema may migrate; current keypairs bind a stable installation identity to an unchanged marker, and first install/reset activate one staged keypair by atomic rename. Production implementation and crash/platform proof remain required.                                                                                                   |

### Final pause acceptance evidence

This table is populated only from commands completed after the host and E2EE
implementations converge. Pause evidence remains narrower than the G0-G7 and
13-journey release gates.

| Timestamp (UTC)                | Platform/host | Scope                              | Exact command or artifact                                                                            | Exit | Counts/duration                                                                      | Result                                                                                           |
| ------------------------------ | ------------- | ---------------------------------- | ---------------------------------------------------------------------------------------------------- | ---: | ------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------ |
| 2026-08-07T19:52:41Z–20:01:59Z | macOS arm64   | Host-authority closure             | `/tmp/react185-host-authority-closure-acceptance.md`                                                 |    0 | 466 PTY + 168 adjacent + 7 exact-close tests; static gates clean                     | Accepted in owned pause scope; P0/P1/P2=0.                                                       |
| 2026-08-07                     | macOS arm64   | E2EE storage lifecycle             | `/tmp/react185-e2ee-storage-acceptance.md`                                                           |    0 | 108 storage + 60 remote-userData + 9 regression + 8 injected-Windows tests           | Accepted in owned pause scope; P0/P1/P2=0.                                                       |
| 2026-08-07T20:21:38Z–20:40:06Z | macOS arm64   | Initial combined validation        | `/tmp/react185-final-combined-validation.md`                                                         |    1 | Prior broad: 827/8,829 with 2 failures; rerun: 828/8,830 with 1 failure              | Blocked only by the 30-second SSH scale fixture setup occurring inside the timed assertion.      |
| 2026-08-07T20:51:09Z–20:54:03Z | macOS arm64   | Test-only scale-fixture correction | `/tmp/react185-broad-ssh-scale-fixture-closure.md`                                                   |    0 | Five SSH and five normal-parallel host-effect + SSH passes; broad exit 0 in 57.695 s | Product command, 15,197-entry scale, oracle, and 30-second assertion timeout remained unchanged. |
| 2026-08-07T21:00:32Z–21:02:59Z | macOS arm64   | Independent combined closure       | `/tmp/react185-final-combined-validation-closure.md`                                                 |    0 | Broad: 829 files/8,831 tests passed; 7/31 skipped; 57.310 s                          | Pause validation accepted; P0/P1/P2=0. Release goalposts and journeys remain unchanged.          |
| 2026-08-07                     | macOS arm64   | Documentation reconciliation       | `/tmp/react185-terminal-authority-docs-audit.md`; `/tmp/react185-terminal-authority-docs-closure.md` |    0 | 3 documents/1,361 lines; four P2s corrected; final P0/P1/P2=0                        | Accepted only for the pause boundary; release classifications and gates remain unchanged.        |

## PR gate

Before committing or opening the PR:

1. Every G0-G7 row is `proven` with current evidence.
2. The required-journey matrix is fully proven on the converged tree.
3. Production, test, documentation, and CI LOC are reported separately.
   Net production LOC is at or below zero, or every positive retained module is
   justified after an independent reachability and duplicate-state-machine
   audit.
4. The capability remains unadvertised until cutover, durable outcomes, exact
   operations, topology attach, and mixed-version proof are complete.
5. Independent repository review and the release-readiness checklist have no
   unresolved correctness, security, compatibility, or performance findings.
6. The multi-host and principal audits remain design evidence only; they do not
   promote G1, G3, G5, or G6 to `proven` without the named production journeys,
   challenge/grant tests, and deletion/reachability evidence.
7. Accepting the host-authority and E2EE-storage pause tranches satisfies none
   of G0-G7, the 13 journeys, final LOC, platform, performance, review, commit,
   push, or PR gates by itself.
