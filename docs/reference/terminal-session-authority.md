# Terminal session authority

Orca treats a terminal pane as one durable logical generation bound to one exact
PTY incarnation. The process that owns the PTY also owns this binding and its
ordered topology journal. Renderer state, SSH leases, workspace snapshots, and
runtime maps are projections; none may infer a replacement binding or destroy a
PTY from absence alone.

This is the implementation contract derived from the SSH authority handover for
STA-3077/#11729. It generalizes that diagnosis across local, daemon, WSL, SSH,
paired-runtime, and remote-server ownership. It replaces quarantine, elapsed-time
windows, retry-count verdicts, and increasingly clever reconciliation; those may
remain only inside an unchanged pre-cutover legacy path.

This contract is the long-term replacement for the containment approaches in
PRs #12264, #12743, and #12600. Their incident evidence and non-destructive
"unknown is not dead" rule remain inputs; their sliding windows, permanent
quarantine verdicts, and peer-store reconciliation are not the target design.

## Document authority

This file is the normative design. Implementation must be changed when it
contradicts this contract; passing focused tests does not amend the design.

- [`terminal-session-authority-delivery.md`](./terminal-session-authority-delivery.md)
  is the proof ledger. It records numeric goalposts, required journeys,
  reduction targets, and exact verification evidence.
- [`terminal-session-authority-handoff.md`](./terminal-session-authority-handoff.md)
  is the continuation boundary. It records the worktree state, accepted
  tranches, unresolved risks, dependency order, and first safe resume command.

No worker report or construction test promotes a goalpost by itself. A delivery
row becomes `proven` only when the named production path and its full-scope
oracle both exist on the converged tree.

Accepting the host-authority or E2EE-storage pause tranche is likewise only a
construction milestone. It does not promote any G0-G7 release goalpost or any
required end-to-end journey in the delivery ledger.

The multi-host and principal audits (task_48dd7af53ff8 and
task_225ba542e4c4) are design inputs, not runtime proof. They require host-local
authority and authentication state to remain separate for every discovered host
and namespace; this document therefore has no app-global ownership transition
or singleton host transport to reconcile.

## Invariants

1. One pane generation has at most one live PTY binding.
2. One PTY incarnation is bound to at most one pane generation.
3. Input, resize, signal, close, output, and exit name the exact binding.
4. A stale operation cannot affect a newer pane or PTY incarnation.
5. Disconnect, timeout, missing transport, and missing projection mean unknown,
   never dead.
6. A topology mutation is acknowledged only after its operation and result are
   durable. Retrying before outcome ACK returns that same result; older retries
   below the durable revision floor fail closed.
7. Output and terminal outcomes are ordered. Gaps require a snapshot and never
   permit silent continuation.
8. Renderer mount, unmount, park, and reveal only attach or detach a view.
9. Routing facts never become identity. An SSH target, connection generation,
   pairing revision, WSL distro, or relay hop can admit a request but cannot
   identify a PTY.
10. Ordinary input and output do not write the topology journal.
11. Host connection, namespace admission, grant, failure, and retirement state
    are never singleton or app-global; their keys include the final host and,
    for namespace state, the host-local namespace.
12. A durable app/device identity proves possession of its private key. A
    process or session nonce is an incarnation fence, not a replacement
    identity and never authorizes adoption of host state.
13. Final-host cumulative cursors are the only delivery cursors. The app has no
    delivery cursor, settlement ledger, receipt ledger, or global failure fence.
14. One exact host, namespace, and PTY binding has at most one active source
    delivery lease. A provisional replacement cannot publish, ACK, mutate, or
    consume credit.
15. Every source span, credit ACK, cancellation, replay, and exit is fenced by
    its delivery token plus provider, client, and owner generations. A match on
    the physical PTY ID alone never admits data.
16. Source replacement fences the predecessor before promoting the provisional
    source. Bytes already queued under the predecessor are rejected after that
    fence and cannot leak into the successor generation.
17. Source activation and failure are namespace-local. Replacing or losing one
    namespace source cannot pause, publish, ACK, or mutate another namespace.

## Identity

The authority host mints `authorityHostId` and `namespaceId`. A namespace is
resolved from a host-local locator for a git worktree, folder workspace, or
floating workspace. Client-local repository IDs and SSH target IDs are not
namespace IDs.

An exact binding contains:

```text
authorityHostId
namespaceId
paneKey
paneGenerationId
ownerIncarnationId
physicalPtyId
ptyIncarnationId
```

`paneKey` is stable placement identity. `paneGenerationId` distinguishes a pane
that was closed and later recreated at the same placement. `ownerIncarnationId`
fences a restarted PTY worker. `ptyIncarnationId` fences reuse of a physical PTY
ID.

The app/device has one bounded stable proof-of-possession identity shared across
its host connections. It consists of a stable public verification identity and
its protected private key; it does not contain a committed/pending predecessor
pair, host-current state, delivery cursor, settlement record, or receipt ledger.
Each process or session creates a fresh unpredictable nonce and discards it when
that process/session ends. A nonce fences an incarnation but cannot be promoted
to a new durable identity.

The security contract is mechanism-neutral. The proof must establish possession
of the stable private key, bind a fresh host challenge to its exact context, and
provide replay, cross-host, cross-namespace, cross-purpose, and cross-connection
separation. The implementation should first evaluate the existing durable E2EE
keypair; it may serve this purpose only when a domain-separated proof satisfies
all of those requirements. Otherwise it must use a dedicated signing key. A
failed fit must not silently weaken the proof or fall back to an unauthenticated
client-supplied identifier.

Identity loading is a security boundary. Explicit first-install provisioning may
create the keypair once; after establishment, a missing, malformed, oversized,
noncanonical, wrong-version, or public/private-mismatched record fails closed and
is never silently regenerated. Loading derives the public key from the private
key and compares it with the stored public identity. Recovery is an explicit
reset and re-enrollment operation that revokes or retires the old device grants
and remote consumer identity before creating a successor. User-data migration
moves the keypair, its establishment evidence, and paired-device credentials as
one lifecycle unit. Establishment evidence is not a second key store, cursor,
receipt, or authority ledger.

The establishment marker names one random installation identity, not the active
consumer key. The current keypair record carries that same installation identity,
so rotating the consumer key does not require a second-file activation commit.
A validated legacy keypair schema that predates installation identity is the only
markerless record eligible for one-way migration. Migration validates and
durably stages the current-schema record with the exact legacy key material
before publishing its marker, then atomically promotes that same stage. Every
crash cut around stage, marker, active-file replacement, and replacement backup
reuses that exact staged key; recovery never generates a different identity. A
legacy keypair found beside a marker fails closed unless the exact validated
migration stage proves that interrupted publication. A current keypair with a
missing or mismatched marker also fails closed; neither shape can masquerade as
an eligible legacy installation.

First install writes and validates a non-active staged current-schema keypair,
publishes its matching installation marker, then atomically renames the staged
record into the active keypair path. Startup may finish only that exact staged
publication; it never generates a different key after the marker exists. Reset
keeps the installation marker unchanged and, only after all old remote identity
retirements and credential revocations complete, atomically replaces the active
keypair with a validated staged successor carrying the same installation
identity. The staging artifact is bounded, private, and never an accepted proof
identity or second logical key store. Canonical user-data migration applies the
same rules to the registry, keypair, marker, and any in-progress staging record;
a partial target is never made active and the source remains recoverable. If
both source and canonical target are complete, migration no-ops only when their
validated installation identity, key lineage, and reset-stage binding agree.
Equivalent validated lineage, not raw JSON serialization or mutable registry and
outbox bytes, decides canonical equality. Two unrelated complete identities are
an ambiguity and fail closed. After a proven publication, later source registry
or outbox drift does not overwrite or invalidate the canonical target; key,
installation, or reset-transaction lineage divergence still fails closed.
Each stage declares `first-install` or `reset`; a reset stage is bound to the
reset transaction ID and immutable old proof-key public fingerprint. The
ordinary loader may finish only a first-install stage when no active keypair
exists. It never promotes a reset stage or replaces an
active keypair; only the matching transaction in `creating-successor` may reuse
and atomically publish that exact stage. Once either stage is durable, recovery
never generates a different key. Reset publication retains that exact stage even
after it becomes the active keypair. Only a later durable phase of the same sole
reset transaction may remove it after verifying that the active and staged key
material still match and that the transaction still names the original
predecessor. Stage, publish, and finalize retries validate both bindings even
after the active path contains the successor. A reused transaction ID with a
different predecessor fingerprint fails closed. There is no successor-only,
activation, publication, or receipt ledger beside the reset transaction; the
retained stage is the bounded crash-recovery artifact.

## Identity reset and re-enrollment

Reset is one resumable main-process transaction, not a collection of revoke
callbacks. Before any mutation it strictly loads the established identity,
marker, device registry, relay revoke outbox, and any existing reset record;
freezes new pairing and authority admission; resolves the bounded immutable set
of known final hosts; and requires every needed retirement capability. Corrupt,
missing, offline, unknown, or incompatible state stops before mutation.

The sole reset record contains only its version, transaction ID, old proof-key
public fingerprint, request time, current phase, and bounded target
host/namespace intent. Each host derives its own consumer principal from that
proof identity and `authorityHostId`; there is no global consumer ID to persist.
The record has no private key, successor key, per-target completion bits, host
cursor, receipt, settlement, delivery cursor, or global failure fence. A crash
after a subset of acknowledgements reissues the same idempotent retirement to
the whole target set; the final-host journal and relay revoke outbox remain the
durable acknowledgement sources.

The phase order is strict and monotonic:

1. Persist reset intent before any remote or local mutation.
2. Reconnect with the old proof identity as needed and durably retire it on
   every known final host. A timeout, disconnect, or lost response remains
   unknown; exact retry or fresh authenticated resume must obtain the explicit
   idempotent retirement result. The same live connection replays its exact
   cached result. After a host restart, a fresh retirement-specific possession
   challenge may confirm that the derived host-local principal is already
   absent without claiming it again; unauthenticated inventory absence cannot.
3. Enqueue every old relay binding in the existing revoke outbox and wait until
   every parsed relay acknowledgement removes its item.
4. Close live mobile, paired-runtime, daemon, and SSH transports only after the
   remote retirement and relay phases complete.
5. Atomically remove old local device/runtime credentials. Per-device revoke
   and mobile host-removal APIs may not bypass this ordering or report success
   after merely scheduling cleanup.
6. Stage, validate, and atomically publish the successor keypair with the same
   installation identity, while retaining the exact transaction-bound stage.
   Durably advance the sole reset record past publication, invalidate cached
   proof material, and recreate any service that captured the old key.
7. Verify the successor and retained stage through the strict loader, durably
   enter the later finalization phase in that same reset record, then remove the
   stage. Enter re-enrollment and remove the transaction record only after that
   cleanup boundary. Only this phase may report completion.

There is no rollback after a host retirement commits. Startup resumes the
recorded phase with the old active key until successor publication, and with the
new key afterward. Unsupported mixed-version peers remain explicitly pending;
disconnect, admission cancellation, legacy revoke, inventory absence, or
host-current state never substitutes for authenticated retirement. Settings
shows durable phase and pending-host status after confirmation, and closing the
dialog cannot cancel a started transaction.

Every storage mutation whose success advances an identity-lifecycle phase uses
an explicit durable write or rename: file sync before publication and containing
directory sync afterward where the platform supports it. A real POSIX sync
failure propagates instead of being reported as durable success; unsupported
platform or filesystem behavior is handled explicitly. This durability is
opt-in at lifecycle boundaries. The ordinary secure-file writer keeps its
existing rename-only cost, so unrelated credential and settings writes do not
inherit synchronous fsync latency.

## Host boundary

The authority runs on the final host that owns the managed PTY. An authoritative
local or WSL PTY is owned by the stable local terminal daemon; the direct
in-process provider remains an isolated legacy path and is never a post-cutover
fallback. A direct SSH PTY is owned by the stable service on the SSH host. In
nested SSH, a shell on host A running `ssh B` remains an A-owned PTY; an Orca
runtime explicitly hosted on B uses B's terminal service and owns its PTYs on B.

The stable host service owns:

- namespace resolution and one writer lease epoch per namespace;
- pane membership and exact bindings;
- idempotent topology operations and their durable results;
- PTY workers, bounded replay, and exact input admission;
- ordered terminal outcomes and durable consumer cursors.

Packaged relays and paired runtimes are transport adapters. App upgrades do not
restart PTY workers. A compatible newer adapter connects to the existing host
service; an incompatible adapter fails before mutation. The service drains or
upgrades its control plane only when workers can remain attached.

`HostConnection` is keyed by `authorityHostId`, not by one process-wide
connection slot or by an SSH endpoint string. Discovery is lazy: a configured or
previously known host is contacted only when a surface needs it, and an
uncontacted or skipped host has no fabricated session, grant, or failure state.
Several host connections may be live concurrently. A restart that skipped a host
must rediscover that same host before resuming its sessions; it must not adopt
host-current state from memory or from another host.

Reconnect is deterministic in the narrow protocol sense: the same authenticated
proof resolves the same final host and namespace, resumes the same durable
consumer principal and cumulative cursor, and either reattaches the exact pane
generation and PTY incarnation or returns an explicit unresolved/rejected
result. Transport loss replaces and fences only the failed connection
generation. While a replacement transport is unavailable, work parks or retries
with bounded backoff and bounded memory; it never busy-loops, fabricates a new
identity, spawns a replacement PTY, adopts host-current state, or lets elapsed
time decide liveness. This is the common contract for daemon, SSH, WSL,
paired-runtime, and remote-server reconnects; their adapters differ only in how
they reach the final host.

Each `NamespaceSession` and its admission, grant, failure, and retirement state
is keyed by the pair `authorityHostId + namespaceId`. A multiplexed
`HostConnection` may carry many such sessions, but one namespace's failure can
only fail that namespace. There is no process-wide failure fence and no
best-effort batch whose success is inferred from a prefix.

The host derives the consumer principal from the authenticated proof and its own
`authorityHostId`. A client-supplied profile/device label is metadata at most;
it is never the principal or a cursor key. A host-wide SSH endpoint credential
authenticates transport access but cannot identify an app/device consumer. The
derived principal is host-local, so the same stable app/device proof yields
independent consumer principals on independent hosts.

For every namespace admission, the host issues a challenge containing exactly:

```text
authorityHostId
namespaceId
currentCas
candidateProcessOrSessionNonce
requestId
exactConnectionGrant
```

The app proves possession over that canonical challenge. The host verifies the
host and namespace, compares the supplied `currentAdmissionCas`, binds the
candidate nonce and request to the exact connection grant, and performs the CAS
transition atomically. Challenge, proof, request, and result are all scoped to
the `authorityHostId + namespaceId` key. A request retry is accepted only when it
is the exact same canonical request for the same grant and request ID; it
returns the original result idempotently. A changed nonce, CAS, namespace,
grant, or request body is rejected. A lost response therefore retries the exact
request; it does not fetch and adopt whatever state the host currently reports.

## Product decisions

- A session surface is scoped by the final host's namespace locator for a git
  worktree, folder workspace, or floating workspace. SSH target IDs, client repo
  IDs, drive spellings, and connection generations are routing aliases only.
- Each namespace has one active topology writer epoch. Other devices observe or
  request handoff; there is no replace-all multi-writer merge.
- Detaching a view keeps the pane generation and PTY alive. Closing is an
  explicit idempotent topology mutation that terminates that exact binding.
- Ambiguous, unavailable, or rejected attach never spawns a replacement PTY.
  Only an explicit create for a fresh pane generation may create a shell.
- PTYs may survive with no connected client. Retention cleanup requires an
  explicit authority operation and exact binding; elapsed time alone never
  proves death.
- Terminal membership, pane generation, binding, and semantic outcome order are
  host-authoritative. Window placement and other non-terminal chrome remain
  client-local.
- Old clients may use an unchanged, visibly isolated legacy namespace before
  cutover. After cutover they are read-only when negotiated or rejected before
  mutation; they cannot open a parallel writable surface.
- Writer and input permission is granted to an authenticated actor for a writer
  epoch and negotiated exact capability. Revocation rotates that authority;
  routing credentials never become terminal identity.

## Operations

Topology mutations carry the authority protocol range, actor and operation IDs,
the caller's base revision, writer lease epoch, and exact expected pane/binding.
Create, bind, close, supersede, exit, and migration import are idempotent. The
authority appends intent, state, and result before publishing the result.
Consumer access is not mutation identity: the authenticated actor and writer
epoch authorize the operation, while admission separately proves that required
consumers and transports are installed. Appending a mutation or semantic outcome
does not select, copy to, or advance any consumer.

Durable append and consumer delivery are separate. A mutation returns after its
canonical result is durable; any physical side effect begins only after that
commit and can be re-ensured by an idempotent retry. Semantic producers likewise
append to the authority journal without waiting for a renderer. Each claimed
consumer has one serialized cursor-only delivery pump on the final host; the host
advances that consumer's cumulative cursor only after its handler settles. An
unavailable consumer therefore retains outcomes until capacity fails closed; it
never creates an app-side cursor, settlement queue, receipt ledger, or global
failure fence, and never blocks the PTY output hot path on UI availability.

Input, resize, signal, and close use a separately negotiated exact capability.
They are not optional identity fields on a legacy operation: an older adapter
could discard those fields and execute the unfenced operation. Exact methods
fail closed when either peer did not negotiate them.

Output uses an attach-time source identity and monotonically ordered spans. The
source identity includes a request binding nonce, so concurrent attaches cannot
admit an old marker for a new subscription. It is not repeated per frame.

A source delivery lease is the bounded right to publish one exact PTY
incarnation for one namespace. Its identity includes a unique delivery token,
the host-service `providerGeneration`, the transport `clientGeneration`, and the
physical-worker `ownerGeneration` plus its owner lease. A candidate source stays
provisional until the authority has validated its binding and fenced any active
predecessor. Promotion first prevents new predecessor reservations and rejects
its queued spans, then makes the candidate active; the reverse order is
forbidden. ACK, replay, pause, cancellation, exit, and source-credit operations
must match the complete active identity.

The bounded byte/scalar-unit credit window is transport flow control only. It
caps unacknowledged source output and memory; it does not wait for stability,
vote on identity, decide liveness, quarantine a source, or reproduce PR #12600's
elapsed-time sliding-window verdict. Exhausted credit pauses publication until
the exact active delivery advances or is explicitly canceled.

Terminal outcomes such as exit and side-effect facts are appended once to one
namespace-global journal before publication. The host derives consumer principals
from authenticated app/device proofs; consumer labels name durable effect or
policy domains, never transport processes. The host physical-effect consumer is
stable for the authority host (`host-effects:<authorityHostId>`), while an
app/device consumer is derived independently on each host. Only the
process/session nonce rotates on restart. The final host stores one
incarnation-fenced cumulative cursor per retained principal, and outcomes are
not copied into app-side queues or ledgers. A genuinely new app/device consumer
starts at the snapshot boundary, while a returning proof-bearing consumer
resumes its final-host cursor after a new process/session nonce is admitted.
Duplicate ACKs are idempotent; wrong principals, grants, or nonces are rejected.
Mutation and outcome IDs encode the namespace's monotonic revision. Compaction
discards only outcomes acknowledged by every retained consumer, retains
unacknowledged outcomes as exact replay exceptions, and rejects older IDs at or
below the durable revision floor. When unsettled retention is exhausted, exact
mutations fail closed for that namespace rather than losing an outcome or
freezing unrelated hosts/namespaces.

The authority checkpoint and boundary materialize the latest bounded,
app-neutral semantic facts for every retained pane, including their event
identities. A new-at-tail consumer therefore receives current title, agent,
command, bell, review-link, and exit state even after older outcomes compact.
Consumer-local policy such as dismissing attention remains in that consumer's
projection and is never promoted to host topology authority.
The materialization retains bounded canonical source outcomes sufficient for
each current fact domain and terminal exit, so host restore and app boundary
application reuse the same event identities and reducer rather than inventing a
parallel semantic state machine or synthetic log.

The app persists only the bounded stable proof-of-possession identity and its
protected key material; it has no app delivery cursor, per-outcome settlement
ledger, receipt ledger, or app-global committed/pending handover pair. The
final-host cumulative cursor is the delivery source of truth. If the app crashes
after applying an idempotent projection but before the host commits its
cumulative ACK, replay reapplies the same event key without changing the
projection twice. Any process/session nonce and request ID needed for an active
attempt are bounded, ephemeral connection state, not a durable predecessor or
host-state cache.

For handover, the app first obtains a host-issued challenge for the exact
`authorityHostId + namespaceId` and exact connection grant, including the host's
current admission CAS, its fresh process/session nonce, and a request ID. It
proves possession of the stable key over that challenge and submits that exact
request. A lost response retries the same canonical proof/request and receives
the same result; a new challenge is required only after the host explicitly
rejects the old one. No host-current snapshot, client-supplied principal, or
different request is ever silently adopted as the app's state.

The final host claims its physical-effect consumer with the current host-service
incarnation and installs an exact effect applier before admitting mutations. It
idempotently applies authority-owned effects such as a retired binding's shutdown,
so a crash between durable close and process termination replays the same work.
The applier advances its cursor only after the exact worker accepted shutdown or
an exact exit, successor, or host process-identity proof establishes that
incarnation complete. A missing session map entry, disconnected adapter, or
failed/unavailable inspection is not that proof and leaves the cursor
unacknowledged.
Each authenticated app or paired device independently claims its host-derived
consumer principal before its authoritative requests are admitted. The final host
stores and advances that principal's cumulative cursor only after app-scoped
policy settles. The host-effect and app/device consumers read the same journal
through separate cursor-only pumps; neither copies outcomes nor advances the
other's cursor. Admission remains closed until the required consumer, its
handler, and its negotiated transport are all installed.

A host-derived consumer principal is not a bearer credential. Claim, handover,
ACK, and retirement are bound to the exact authenticated connection grant and
process/session nonce that installed the handler; looking up an operation by a
client-supplied consumer label alone is forbidden. The host derives the stable
app/device principal from the proof-bearing identity and its own
`authorityHostId`, never from a client-supplied profile ID. A host-wide SSH
endpoint credential is transport authentication, not an app/device principal,
and cannot key or authorize a consumer cursor. Partial connection setup
atomically rolls back its claim, handler, observers, and capability grant, and an
adapter cannot advertise authoritative mutation until the exact namespace
consumer and transport handler are both live.

Transport admission stages a handover without rotating the durable incumbent.
After boundary acceptance, the final host durably commits the policy-consumer
claim and cursor. In the same serialized operation it installs the
connection-bound grant and exact-retry result before returning success. Failure
before the durable append preserves the incumbent. A socket-write callback never
authorizes or rolls back that commit: an uncertain response on the same live
connection retries the exact challenge/proof/request and returns the original
grant. After a host or connection restart, a fresh authenticated challenge
resumes the durable claim; it never adopts unauthenticated host-current state or
persists a transport token in a second grant ledger. The client validates the
exact committed grant before it activates mutation, ACK, or delivery. The
negotiated wire grant establishes protocol support but does not by itself
authorize a mutation.

The namespace is the admission transaction; a connection is only an authenticated
multiplexing transport. Each namespace stages, publishes, and commits its own exact
grant, so failure in one namespace retains that namespace's incumbent without
invalidating another namespace's completed grant. A transport must not expose a
best-effort multi-namespace batch as active after only a prefix committed.

Process-memory compensation is not atomicity: a crash before the durable append
preserves the incumbent, while a crash after it leaves the consumer claim and
cursor available for authenticated resume. This transaction is not an app
cursor, receipt ledger, durable transport-grant ledger, or global admission
fence.

For a first claim, the host holds the producer and publishes the complete
`new-at-tail` boundary before appending the consumer claim. The app durably
commits that caught-up boundary and explicitly accepts its exact identity; a
socket write, notification, or IPC-send settlement is not acceptance. The host
then verifies the host-issued proof at the same high-water mark, CAS-commits the
host-derived principal, and activates delivery. A host-current snapshot never
proves that the boundary was accepted; an uncertain failure before the claim
leaves the incumbent unchanged and retries the exact challenge/proof/request
without a boundary ledger. The app does not treat any host-current state as its
own until this per-namespace handshake completes.

Consumer retention follows authorization, not elapsed time. Revoking a paired
device or retiring a host-derived app/device principal is an explicit durable
consumer-retirement operation fenced to the exact `authorityHostId`,
`namespaceId`, connection grant, and process/session nonce. Only that operation
may remove the final-host cursor and release outcomes it had not acknowledged.
Disconnect and inactivity alone retain the cursor and therefore eventually apply
backpressure rather than lose effects; a failure retires only its namespace
session and cannot install a global failure fence.

An exact close requested while its transport is unavailable is persisted with the
complete captured binding. That persisted record is the only pending-close source
of truth. Reconnect inventory may confirm the same binding before mutation or
positively identify a successor; it cannot replace the captured target. Missing
inventory remains unresolved. The close completes only from its durable exit
outcome or a positively proven successor, never from polling absence.

## App and renderer projection

The main process owns a bounded durable projection per authenticated
`authorityHostId + namespaceId` and host-derived principal. It installs the
authority subscription before reading the snapshot, holds that namespace's
producer while it commits the snapshot and contiguous replay, and then resumes
ordered delivery. For each later outcome it transactionally commits the
projected state and authority event key before the final host cumulatively ACKs
that exact consumer cursor. A crash after projection but before ACK safely
replays the same event key. The projection may retain event keys needed to make
its rows idempotent, but it cannot retain an app delivery cursor, per-outcome
settlement ledger, receipt ledger, or tombstone log that authorizes the host ACK.

Boundary acceptance names the exact `authorityHostId + namespaceId`, connection
grant, process/session nonce, host-derived principal, high-water mark, and
boundary identity. It is an idempotent admission handshake, not another delivery
cursor or settlement log.

A boundary projection represents its declared outcome high-water mark. When a
returning consumer is behind that mark, the app stages the boundary, replays the
contiguous suffix against its prior durable projection before reconciling the
staged snapshot with the final replay transaction and ACKing the high-water
outcome. This returning replay-before-reconciliation order is mandatory; the
boundary must not overwrite events that the suffix has not yet applied.
Only a host-attested first claim whose acknowledged sequence already equals the
high-water mark may install that snapshot immediately. First claim versus
returning handover is attested per namespace by the final host and cannot be
inferred from app-global metadata or host-current state.

The host may deliver a bounded contiguous page and the app commits and
cumulatively ACKs that page as one unit. Backlog catch-up must not require one
`synchronous=FULL` transaction and one transport round trip per historical
outcome; batching never changes event order or the crash-before-ACK contract.
Page-aware delivery and page-tail ACKs are part of the first shipped
namespace-cursor capability contract. Peers without that whole capability never
receive these publications and remain on the isolated legacy path; no permanent
branch preserves semantics from an unshipped construction version.

Producer-hold acquisition is linearizable with producer admission: operations
already admitted drain before the snapshot, while no operation can pass a stale
no-hold check and enqueue after the hold begins. Release resumes those producers
without inserting another ordering queue.

The app-scoped renderer controller subscribes to committed projection deltas
before reading its projection snapshot. React views attach to that controller.
Parking removes an expensive view while keeping the controller and projection
subscription alive. Renderer delivery, callback completion, mount state, and IPC
send success never authorize a final-host ACK; renderer loss is recovered from the
committed main-process projection.

Each authenticated connection generation owns its delivery queue and cancellation
signal. Disconnect or reconnect fences that queue before installing a successor,
so a non-settling transport ACK cannot serialize work for the next connection.
Transport attempts have bounded settlement and reconnect retries automatically
with bounded-resource backoff until disposal; those deadlines bound unavailable
I/O only and never decide identity, liveness, or whether an outcome was ACKed.

Title, bell, command completion, PR-link, and exit effects are keyed by authority
event sequence. The main-process projection writer must apply each
correctness-bearing fact idempotently and durably before ACK. Calling an arbitrary
callback and persisting its ACK afterward is not sufficient: a crash between
those steps would replay the callback. A sink that cannot prove durable
idempotence cannot be installed as an authoritative consumer, and admission stays
closed. A process-memory set, map, promise cache, or high-water mark is only an
intra-incarnation optimization; it cannot authorize ACK because it disappears in
the exact crash-before-ACK case the protocol must recover.

Renderer state changes such as title, status, command completion, PR-link,
attention, and exit are deterministic projections of the durable event. Toasts,
sounds, and other presentation cues derive from that committed projection; they
never mutate authority or stand in for durable settlement. A remount or process
restart can therefore replay without duplicating correctness-bearing state, and
an unmounted pane cannot lose it. React lifecycle readiness, elapsed-time
windows, and mount pins do not decide terminal liveness or ownership.

## Migration

Migration is namespace-scoped and single-writer:

1. Negotiate authority support and acquire a migration writer epoch.
2. Freeze legacy topology writes briefly and inventory live PTYs, local leases,
   local layout partitions, and the remote workspace snapshot without mutation.
3. Import only exact one-to-one pane/PTY matches with incarnation proof.
4. Preserve ambiguous or missing matches in a non-destructive legacy recovery
   surface. Do not attach, expire, kill, or respawn them automatically.
5. Commit the import and authority cutover marker in one durable operation.
6. Rebuild projections from the authority. Retain legacy backups and tombstones
   until explicit acknowledgement; never dual-write.

The bounded importer is a pure reader and planner. Its complete namespace-scoped
result—imported bindings, unresolved recovery rows, worker route evidence, and
the cutover marker—is one authority log record that can replay without any
legacy file. The authority journal never stores a reference into a second
catalog log, performs suffix reconciliation from that log, or depends on it to
restore a snapshot. An inventory spanning several namespaces produces one
independent transaction per namespace while the legacy writer remains frozen;
failure leaves that namespace visibly uncut-over rather than partially imported.
After a successful cutover, an unresolved row fences only the pane, PTY, or worker
identity it names; it does not globally freeze unrelated authoritative operations
or consumer admission. Explicit acknowledgement remains an incarnation-fenced
namespace operation after clients connect.

After cutover, clients without the required authority capability cannot mutate
the namespace. A compatible read-only observer may attach; otherwise the client
must upgrade or use a visibly isolated legacy surface. Rollback cannot silently
discard operations committed after cutover.

## Minimal implementation shape

The production design has four roles:

1. One final-host authority service owns namespaces, bindings, PTY workers,
   mutation results, terminal outcomes, and consumer cursors.
2. Local, daemon, SSH, WSL, relay, and paired-runtime adapters expose the same
   exact operations and carry negotiated capabilities. They do not own another
   pane or PTY state machine.
3. One app-scoped controller consumes snapshot plus ordered events and delivers
   terminal outcomes. React views are clients of that controller.
4. One bounded legacy importer reads old stores before cutover. It cannot mutate
   an authoritative namespace or remain as a second writer after cutover. Its
   output is committed directly by the authority; there is no durable migration
   catalog beside the authority journal.

These four roles are also the deletion oracle. A production module that only
mirrors, translates, validates, caches, retries, or reconciles state already
owned by another role must be merged into that owner or deleted. Transport
adapters may encode transport mechanics but cannot retain a parallel authority
state machine. A net-positive construction tree is therefore unfinished work,
not evidence that the replacement needs more layers.

Compatibility is selected once at admission. An exact operation never retries
as an ID-only operation, and an authoritative namespace never falls back to a
legacy lease, layout, or provider mutation after admission. Unsupported peers
remain on the unchanged isolated legacy path or fail closed before mutation.

Adding authority beside the old writers is not the end state. Once a path reads
its authoritative projection, its former reconciliation, quarantine, retry,
dual-write, and timing-verdict code must be removed. Prefer one shared state
transition and validation implementation over transport-specific copies.

## Compatibility and performance

Negotiation uses protocol major/minor ranges and explicit capabilities, not an
app build ID. Unknown required capabilities fail before mutation. The legacy
terminal wire remains unchanged for peers that did not negotiate exact authority.
Namespace-cursor delivery is likewise capability-negotiated: after negotiation,
every delivery carries its authenticated previous sequence and omission fails
closed; a peer without that capability remains on the isolated legacy path. The
existing exit-only per-outcome delivery capability cannot be reinterpreted as
namespace-cursor delivery; the new semantics require a distinct capability
version or name.

The first boundary on that capability carries the complete bounded consumer
projection together with its acknowledged sequence and outcome high-water mark;
cursor numbers alone are not a snapshot. A decoder may accept an absent optional
field to parse an older peer, but authoritative app admission must reject that
boundary before ACK or mutation capability is granted.

Authority admission is O(1). There is no startup-blocking SSH capability probe,
per-frame UUID, pane scan, provider listing, or journal write on the input/output
hot paths. An unavailable transport uses bounded waits or backoff and cannot
schedule an unbounded microtask, timer, promise, listener, log, or allocation
loop. Existing latency, backpressure, restore, memory, and scale ceilings may not
increase. The release gates cover local, daemon, direct and nested SSH,
paired runtime, remote server, folder/floating workspaces, macOS, Linux, Windows,
WSL, and both version-skew directions.

Sandboxed preload compatibility is judged at the emitted artifact boundary, not
from the TypeScript import graph. The build guard runs in `generateBundle`
before output writes, covers every preload chunk plus the main-build
`browser-window-close-preload` entry, and excludes ordinary main-process chunks.
Only the exact external module `electron` is permitted. Bare/static imports,
dynamic imports, helper chunks, and literal, renamed, or non-literal `require`
forms fail closed so an unsafe preload cannot remain in `out/` for a later start
or package step.

Implementation status, deletion targets, and required proof are tracked in
[`terminal-session-authority-delivery.md`](./terminal-session-authority-delivery.md).
