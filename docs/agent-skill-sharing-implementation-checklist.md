# Agent skill sharing implementation checklist

Status: proposed.

Last updated: 2026-08-11.

Source plan: [Agent skill sharing and installation plan](./agent-skill-sharing-installation-plan.md).

This checklist turns the architecture plan into ordered implementation and release work. A checked
item means evidence exists in code, tests, reviewed infrastructure, or release documentation; it
does not mean the surrounding phase is complete.

## Definition of done

- [ ] A user can package a private local skill, choose its audience, and receive a durable Orca
      share URL.
- [ ] An authorized recipient can inspect and install an immutable version globally or into a Git
      worktree or plain folder workspace.
- [ ] Installation works on local macOS, Linux, native Windows, WSL, paired Orca runtimes, and
      supported SSH targets.
- [ ] One canonical `.agents/skills/<skill-name>` copy is installed; provider-specific placements
      are reconciled only for detected agents.
- [ ] Install, update, rollback, and removal preserve modified or unowned local content unless the
      user explicitly approves replacement.
- [ ] Package ingestion rejects unsafe archives before any destination mutation.
- [ ] Interrupted operations recover to a complete previous or requested version.
- [ ] Private package bytes remain access-controlled, published versions persist until deletion,
      and incomplete uploads expire automatically.
- [ ] Mixed-version clients and remote hosts fail safely through capability negotiation.
- [ ] Cloud resources are Terraform-owned, monitored, recoverable, and protected by independent
      upload, download, and remote-install kill switches.

## 0. Confirm scope and ownership

### Product and legal decisions

- [x] Record `vercel-labs/skills` as a behavioral reference only.
- [x] Record upstream baseline commit `c6f69c631292444cc541ac6d91e2226b0ff247da`.
- [x] Decide not to copy upstream source, tests, fixtures, registry data, or path tables.
- [x] Decide Orca will not depend on the upstream CLI or an unsupported programmatic API.
- [x] Decide V1 accepts Orca package sources only; Git, npm, and community registries remain with
      existing tools.
- [ ] Add an architecture decision record covering the reference-only boundary and review it with
      engineering and legal owners.
- [ ] Add a review check that flags any proposed copied or mechanically translated upstream
      material so attribution and licensing can be reconsidered before merge.
- [ ] Assign desktop, runtime, Cloud API, Terraform, security, design, and release owners.
- [ ] Confirm the first release ends after WSL and SSH support; keep team reconciliation as a later
      product milestone.

### Product semantics

- [ ] Confirm private means authorized Orca users and organizations, not end-to-end encryption
      from Orca Cloud operators.
- [ ] Confirm a published immutable version persists until package or version deletion; it has no
      age-based object expiry.
- [ ] Confirm an unfinished upload grant expires after 15 minutes and its quarantine object is
      deleted after one day.
- [ ] Confirm a durable share URL identifies an authorization record, not a GCS object or bearer
      credential.
- [ ] Confirm a signed download grant lasts five minutes and is the maximum share-revocation lag.
- [ ] Confirm updates create immutable versions and never mutate existing package objects.
- [ ] Confirm rollback installs a selected prior immutable version.
- [ ] Confirm revoking or deleting a Cloud share does not silently remove existing local installs.
- [ ] Confirm sharing and updating use an artifact-like flow—preview, upload, durable link, update,
      unshare/delete—while retaining skill-specific version, ACL, trust, and install semantics.
- [ ] Confirm V1 has no checked-in workspace desired-state lockfile and no automatic fleet-wide
      installation.

### Existing-code and provider research

- [ ] Inventory current skill discovery, `observeSkillPackage`, package identity, topology, and
      freshness code; record reusable contracts and missing behavior.
- [ ] Inventory plugin staging, provenance, lock serialization, and Windows rename retry designs;
      extract only primitives that both domains can name and test accurately.
- [ ] Inventory current desktop IPC and remote skill RPC registration.
- [ ] Inventory existing SSH execution and file-transfer providers and identify the host-side
      installer entry point.
- [ ] Research official documentation for every initially supported agent's global and project
      skill directories.
- [ ] Verify each provider path with a real installation on every supported platform.
- [ ] Record whether each provider reads `.agents/skills` directly, how it is detected, and which
      alias mechanisms it supports.
- [ ] Add a normal reviewed maintenance process for provider registry changes; do not create an
      upstream synchronization job.

## 1. Define package and install contracts

### Shared package manifest

- [ ] Add `src/shared/skill-package-manifest.ts`.
- [ ] Define `SkillPackageManifestV1` with schema version, stable package ID, immutable version ID,
      name, description, creation time, file identities, and package digest.
- [ ] Normalize manifest paths to `/` while keeping filesystem conversion host-owned.
- [ ] Define the canonical digest algorithm over normalized paths, file identity, executable state,
      and classification.
- [ ] Require `skill/SKILL.md`, valid frontmatter, and agreement between skill and package names.
- [ ] Specify deterministic serialization so identical inputs produce identical identities across
      macOS, Linux, Windows, and WSL.
- [ ] Version the schema and require additive changes or a new schema version.
- [ ] Reject unknown schema versions with a stable error category.

### Package limits and file policy

- [ ] Enforce maximum path depth 16.
- [ ] Enforce maximum 2,048 archive entries.
- [ ] Enforce maximum 512 regular files.
- [ ] Enforce maximum 4 MiB per file.
- [ ] Enforce maximum 32 MiB total extracted bytes.
- [ ] Enforce maximum 40 MiB compressed bytes.
- [ ] Reject absolute, parent-traversal, NUL-containing, and Windows drive-prefixed paths.
- [ ] Reject duplicate normalized paths and Unicode or case-fold collisions.
- [ ] Reject symlinks, hardlinks, devices, FIFOs, sockets, encrypted entries, and other special
      files in V1.
- [ ] Preserve executable modes represented by the package manifest.
- [ ] Document that install never executes package scripts.

### Install request, preview, and result

- [ ] Add `src/shared/skill-install-contract.ts`.
- [ ] Define requests with operation ID, immutable package identity, ingress kind, destination, and
      optional conflict resolution.
- [ ] Support download-grant, staged-upload, and trusted in-process local-file ingress.
- [ ] Ensure arbitrary remote RPC callers cannot supply a local filesystem path.
- [ ] Model global, Git worktree, and folder-workspace destinations without assuming Git exists.
- [ ] Define preview output for destination, current state, provider coverage, conflicts, and trust
      metadata.
- [ ] Define structured installed, updated, unchanged, conflict, partial, and failed results.
- [ ] Define stable error categories for admission, transport, archive, filesystem, conflict,
      recovery, provider placement, and compatibility failures.
- [ ] Ensure responses never include grants, credentials, ACL membership, or private package
      contents.

### Capability and wire compatibility

- [ ] Add `src/shared/skill-install-capability.ts` with `skills.install.v1` and an update-required
      compatibility message.
- [ ] Read and apply `docs/reference/remote-wire-compatibility.md` before changing RPC contracts.
- [ ] Add new methods without changing existing discovery behavior.
- [ ] Keep new request and response fields optional until all supported peers understand them.
- [ ] Do not add a terminal stream opcode for skill installation.
- [ ] Define behavior for new client/old host, old client/new host, and capability loss during an
      operation.

### Phase 1 contract gate

- [ ] Review package, ingress, conflict, result, and capability contracts before implementing
      filesystem mutation or Cloud APIs.
- [ ] Freeze stable V1 error categories used by desktop, runtime, SSH, and Cloud tests.

## 2. Build and validate packages

### Package creation

- [ ] Add `src/main/skills/skill-package-creation.ts`.
- [ ] Accept a specific skill directory rather than an arbitrary parent tree.
- [ ] Observe and validate the source before staging.
- [ ] Copy the source into an owner-private staging directory.
- [ ] Observe the staged copy again and fail if its identity differs from the source snapshot.
- [ ] Generate a deterministic tar archive with `manifest.json` and a `skill/` envelope.
- [ ] Include only `skill/` contents in the eventual installed directory.
- [ ] Bind the user-visible share preview to the final staged digest.
- [ ] Clean staging files on success, cancellation, source drift, and error.

### Bounded extraction

- [ ] Add `src/main/skills/skill-package-extraction.ts`.
- [ ] Stream archive inspection and extraction without buffering the entire package.
- [ ] Validate `manifest.json` before trusting archive file metadata.
- [ ] Enforce compressed, extracted, entry, file, depth, and per-file limits during extraction,
      not only after it.
- [ ] Create extraction staging on the same filesystem as the canonical destination.
- [ ] Convert manifest paths with the destination runtime's path APIs.
- [ ] Re-observe extracted `skill/` and compare every file identity and package digest.
- [ ] Delete partial extraction bytes on cancellation or failure.

### Package tests

- [ ] Test deterministic manifests, archives, and digests on every target operating system.
- [ ] Test source changes during packaging.
- [ ] Test CRLF/LF behavior explicitly and document whether byte identity changes.
- [ ] Test executable-mode preservation and Windows's mode limitations.
- [ ] Test missing, malformed, and identity-mismatched `SKILL.md` files.
- [ ] Test every size, count, and depth boundary at limit, one below, and one above.
- [ ] Test traversal, absolute paths, drive paths, Unicode/case collisions, duplicate paths, all
      rejected link and special-file types, and encrypted entries.
- [ ] Test truncated archives and invalid tar and content checksums.
- [ ] Fuzz archive path normalization and envelope parsing with bounded resources.

### Phase 2 package gate

- [ ] Prove invalid archive classes fail before destination mutation.
- [ ] Prove the same source bytes produce the same digest on macOS, Linux, native Windows, and WSL.
- [ ] Prove package creation and extraction require no `npx`, external Node installation, or
      upstream CLI runtime.

## 3. Implement the local installer transaction

### Destination resolution

- [ ] Add `src/main/skills/skill-install-destinations.ts`.
- [ ] Resolve global canonical roots as `<host-home>/.agents/skills/<skill-name>` on the executing
      host.
- [ ] Resolve workspace canonical roots from runtime-owned worktree or folder-workspace identity.
- [ ] Reject client-supplied remote paths that do not resolve to the selected workspace identity.
- [ ] Resolve WSL home, paths, and target distro inside the selected distro.
- [ ] Keep all path joins platform-native and reject destination escapes after realpath-aware
      containment checks.
- [ ] Support long Windows paths and case-insensitive destination collision checks.

### Admission, locking, and ingress

- [ ] Add `src/main/skills/skill-package-download.ts`.
- [ ] Add `src/main/skills/skill-install-service.ts`.
- [ ] Validate request shape, schema, capability, package identity, scope, destination, and policy
      before download or mutation.
- [ ] Recover prior journals for the same destination before planning a new operation.
- [ ] Acquire a filesystem-backed cross-process lock keyed by canonical destination.
- [ ] Bound lock wait time and return a retryable busy result.
- [ ] Stream ingress to an owner-private bounded temporary file and hash it while downloading.
- [ ] Require HTTPS whenever the configured Cloud endpoint uses HTTPS.
- [ ] Allow only configured Orca skill-bucket origins and reject credential-bearing cross-host
      redirects.
- [ ] Check expected compressed bytes, archive SHA-256, package digest, cancellation, grant expiry,
      and disconnects.
- [ ] Delete partial ingress bytes on every incomplete path.

### Planning and conflict handling

- [ ] Add `src/main/skills/skill-install-planner.ts`.
- [ ] Classify missing canonical destinations as installable.
- [ ] Classify an identical requested digest as unchanged and continue placement repair.
- [ ] Permit clean updates only when installed bytes still match Orca provenance.
- [ ] Return a modified conflict when installed bytes drift from their receipt.
- [ ] Return an unowned conflict when a destination exists without Orca provenance.
- [ ] Return topology conflicts for files, external links, broken links, and name collisions.
- [ ] Classify every requested provider placement independently.
- [ ] Repeat current-state inspection immediately before commit and invalidate stale previews.
- [ ] Require explicit confirmation before discarding local modifications or unowned content.

### Durable commit and recovery

- [ ] Add `src/main/skills/skill-install-transaction.ts`.
- [ ] Copy extracted bytes into a hidden sibling staging directory and verify the digest again.
- [ ] Preserve executable modes where the host supports them.
- [ ] Keep staging, replacement, and backup on the destination filesystem.
- [ ] Write and durably flush a versioned transaction journal before moving the current
      destination.
- [ ] Move an approved existing destination to a journal-owned backup.
- [ ] Rename verified staging into the canonical path.
- [ ] Add bounded retries for Windows `EPERM`, `EACCES`, and `EBUSY` rename races caused by
      antivirus or indexing.
- [ ] Observe the committed destination and require the requested digest.
- [ ] Restore the backup after failed commit and retain sufficient journal state after a crash.
- [ ] Never remove a path based only on a filename pattern; require journal ownership,
      containment, and expected identities.
- [ ] Run bounded recovery at startup and before later operations for the destination.

### Provenance

- [ ] Add `src/main/skills/skill-install-provenance.ts`.
- [ ] Store versioned receipts outside installed skill directories.
- [ ] Record package/version IDs, digest, scope, destination identity, canonical identity,
      placements, previous version, timestamp, and runtime identity.
- [ ] Exclude credentials, grants, share values, manifests, and package contents.
- [ ] Serialize receipt updates across processes.
- [ ] Write receipt updates through durable temporary-file replacement.
- [ ] Support aggregate-index reconstruction from bounded per-install receipts.
- [ ] Mark the journal complete only after receipt publication, then remove transaction backups and
      staging.

### Verification and discovery

- [ ] Re-run skill discovery on the destination after commit.
- [ ] Verify the canonical skill and successful provider placements are observable.
- [ ] Determine success from installed bytes and discovery, not process exit alone.
- [ ] Invalidate renderer skill caches and refresh the Skills page.
- [ ] Return canonical success with `partial` when an optional provider placement fails.

## 4. Implement provider placements

### Provider registry

- [ ] Add `src/main/skills/skill-provider-destinations.ts`.
- [ ] Add data-only records for Orca agent ID, canonical-root support, global/project resolvers,
      detection evidence, and platform alias support.
- [ ] Populate only provider paths independently verified from official documentation and real
      installations.
- [ ] Detect an agent before creating its provider-specific configuration root.
- [ ] Avoid modifying roots for agents that consume `.agents/skills` directly.

### Placement reconciliation

- [ ] Add `src/main/skills/skill-placement-reconciliation.ts`.
- [ ] Create relative directory aliases from real parent directories on POSIX.
- [ ] Create directory junctions with absolute canonical targets on Windows.
- [ ] Detect provider parents already linked to canonical storage.
- [ ] Fall back to an independently copied and verified directory when aliases are unavailable or
      denied and policy allows it.
- [ ] Record each canonical copy, provider alias, junction, or independent-copy topology.
- [ ] Reconcile placements idempotently after install and update.
- [ ] Repair broken Orca-owned aliases.
- [ ] Leave unowned or modified provider placements untouched unless explicitly replaced.
- [ ] Preserve canonical success when a provider placement fails and make coverage retryable.

### Provider validation

- [ ] Confirm every initial provider discovers a global canonical or reconciled install.
- [ ] Confirm every initial provider discovers a workspace install only in that workspace.
- [ ] Test symlink, junction, and copy fallback behavior after provider and canonical parent paths
      are moved or linked.
- [ ] Test provider release upgrades against the registry through the normal review process.

## 5. Implement update, rollback, and removal

### Update and rollback

- [ ] Resolve the latest accessible immutable Cloud version without mutating local state.
- [ ] Compare the requested digest with provenance and observe current bytes before offering an
      update.
- [ ] Route clean updates through the same install transaction.
- [ ] Offer keep-local, authorized publish-as-new-version, and explicit discard-and-replace choices
      for modified installs.
- [ ] Reconcile recorded aliases, junctions, and independent copies during updates.
- [ ] Implement rollback as installation of a selected retained immutable version.
- [ ] Never invoke `npx skills update` or write ownership metadata for the community CLI.

### Local removal

- [ ] Observe the canonical destination and every receipt-owned placement before mutation.
- [ ] Remove only aliases or junctions that still target the recorded canonical path.
- [ ] Remove independent copies only when they match their receipt unless discard is explicit.
- [ ] Remove the canonical copy only when Orca owns it, it is unmodified, and no retained receipt
      depends on it.
- [ ] Publish provenance changes durably before completing removal.
- [ ] Leave changed or unowned paths intact and report exactly what remains.

### Recovery failure injection

- [ ] Inject failure before and after every journal transition.
- [ ] Verify partial downloads and extraction staging are deleted.
- [ ] Verify a moved destination is restored from backup.
- [ ] Verify a placed destination without a receipt is completed or restored according to journal
      state.
- [ ] Verify a published receipt with an incomplete journal is finalized safely.
- [ ] Verify interrupted placement reconciliation preserves the canonical install and retries.
- [ ] Test cancellation during download, extraction, staging copy, commit, provenance, and
      placement reconciliation.

## 6. Provision GCP infrastructure

### Environment and Terraform prerequisites

- [x] Inspect the active `onorca-cloud` project read-only and record the existing Cloud Run, GCS,
      Cloud SQL, IAM, and enabled-service baseline.
- [ ] Locate the authoritative Orca Cloud Terraform worktree, state, modules, and deployment
      pipeline.
- [ ] Confirm or create a separate staging GCP project before exercising new lifecycle and IAM
      behavior.
- [ ] Confirm production names and quotas, including availability of
      `onorca-cloud-skill-packages`.
- [ ] Confirm `US` storage satisfies initial residency requirements.
- [ ] Confirm Cloud SQL connection and PostgreSQL user provisioning conventions.
- [ ] Keep Firestore, Cloud Tasks, and new Pub/Sub dependencies out of V1.
- [ ] Declare every durable resource and IAM binding in Terraform; do not provision them manually
      with `gcloud`.

### Dedicated GCS bucket

- [ ] Declare private bucket `onorca-cloud-skill-packages`, subject to Terraform validation.
- [ ] Set location to `US` for parity with current artifact storage.
- [ ] Enforce uniform bucket-level access and public-access prevention.
- [ ] Configure seven-day soft delete.
- [ ] Keep object versioning disabled and record object generations in PostgreSQL.
- [ ] Add a one-day deletion lifecycle for `uploads/` quarantine objects only.
- [ ] Add exact approved production and development Orca origins to CORS; never use `*`.
- [ ] Allow only required signed POST upload and GET/HEAD download behavior and response headers.
- [ ] Keep the bucket off public custom domains.
- [ ] Define immutable final keys as
      `packages/v1/sha256/<prefix>/<package-digest>/package.tar.gz`.
- [ ] Define tenant-bound random quarantine keys as `uploads/<upload-id>/package.tar.gz`.

### Database and secret

- [ ] Declare database `orca_skills` on existing regional PostgreSQL 17 instance
      `orca-cloud-auth-db`.
- [ ] Declare dedicated principal `orca_skills_app` with access only to `orca_skills`.
- [ ] Store its connection URL in Secret Manager as `orca-cloud-skills-database-url`.
- [ ] Attach the existing Cloud SQL instance to `orca-cloud-api` without replacing the service.
- [ ] Inject only the skill database secret into the API service.
- [ ] Verify backups and point-in-time recovery cover the new database.

### IAM

- [ ] Grant `orca-cloud-api@onorca-cloud.iam.gserviceaccount.com` bucket-scoped
      `roles/storage.objectUser`.
- [ ] Grant the API service account `roles/cloudsql.client` for the existing instance.
- [ ] Grant service-account-scoped IAM Credentials `signBlob` for self-signing V4 policies and
      URLs.
- [ ] Grant Secret Manager accessor only for skill-specific secrets.
- [ ] Verify bucket IAM contains neither `allUsers` nor `allAuthenticatedUsers`.
- [ ] Do not grant desktop, remote runtime, or end-user identities direct bucket IAM.
- [ ] Do not create or distribute long-lived GCP service-account keys.
- [ ] Keep deployment-account permissions unchanged except for reviewed Terraform management
      requirements.

### Cloud Run configuration

- [ ] Extend `orca-cloud-api` in `us-central1`; do not create a separate V1 worker service.
- [ ] Configure bucket, 40 MiB compressed limit, 15-minute upload TTL, five-minute download TTL,
      fixed finalize concurrency, and skill database URL.
- [ ] Reuse existing auth base URL and application CORS configuration.
- [ ] Stream validation with fixed buffers under the existing 512 MiB memory limit.
- [ ] Add a small per-instance finalization semaphore and retryable `429` or `503` with
      `Retry-After` when saturated.
- [ ] Preserve current service scaling initially and tune only from measured CPU, latency,
      database, and error data.
- [ ] Define criteria for splitting finalization into a worker service if it harms existing API
      traffic.

### Terraform review and apply

- [ ] Format and validate Terraform.
- [ ] Produce and review a staging plan.
- [ ] Verify the plan does not replace the existing artifact bucket, Cloud SQL instance, Cloud Run
      services, or unrelated IAM.
- [ ] Apply to staging and capture resource and IAM verification evidence.
- [ ] Produce and review the production plan after staging gates pass.
- [ ] Apply the approved production plan only during the rollout phase.
- [ ] Verify production with read-only bucket, Cloud Run, database, IAM, lifecycle, and CORS
      commands without printing secret payloads or signed values.

## 7. Implement Cloud metadata and APIs

### PostgreSQL migrations

- [ ] Add `skill_packages` with owner organization, slug/name, creator, timestamps, and deletion
      state.
- [ ] Add immutable `skill_package_versions` with package and archive identities, GCS key and
      generation, sizes, manifest, release notes, creator, and publication state.
- [ ] Add tenant/user-bound `skill_package_uploads` with quarantine identity, expiry,
      finalization state, and failure category.
- [ ] Add `skill_package_acl` for organization and user principals and permissions.
- [ ] Add unpredictable, revocable, optionally version-pinned `skill_share_records`.
- [ ] Add bounded `skill_package_audit_events` without contents, filenames, or signed values.
- [ ] Add unique package slug per organization, immutable version and digest constraints, and
      unique final GCS key/generation constraints.
- [ ] Add active-share, ACL-principal, and pending-upload expiration indexes.
- [ ] Add foreign keys preventing blob-reference deletion while a published version uses it.
- [ ] Test forward migration, rollback strategy, backup restoration, and migration compatibility
      during mixed API versions.

### Authorization and lifecycle model

- [ ] Begin every share resolution, grant, update lookup, and revoke mutation with an authenticated
      principal.
- [ ] Evaluate package ownership and ACL in the same request.
- [ ] Ensure share ID locates a record but never authorizes access by itself.
- [ ] Return constant-shape authorization failures that do not disclose package existence.
- [ ] Recheck organization membership for every grant, including after preview.
- [ ] Apply organization retention and legal deletion rules over product rollback retention.
- [ ] Make package deletion revoke shares before dereferencing immutable objects.
- [ ] Delete an object only after a transaction proves no retained version references it.
- [ ] Design metadata/object reconciliation for partial publication and deletion failures.

### Upload and finalization APIs

- [ ] Implement `POST /v1/skill-packages/uploads` with existing authentication, organization
      membership, quota, rate, and concurrency checks.
- [ ] Insert a single-use pending upload before issuing a grant.
- [ ] Create a 15-minute V4 signed POST policy bound to exact key, content type, upload ID, expected
      archive SHA-256 metadata, and 40 MiB length range.
- [ ] Upload directly from the client to GCS without routing package bytes through Cloud Run.
- [ ] Implement idempotent finalize by upload ID and manifest identity.
- [ ] Validate GCS key, size, type, metadata, tenant, generation, and expiry before streaming.
- [ ] Stream once to calculate archive SHA-256 and validate envelope, manifest, paths, limits, and
      package digest.
- [ ] Promote with an if-absent generation precondition to the content-addressed final key.
- [ ] If the final key exists, verify recorded identity without exposing cross-tenant
      deduplication.
- [ ] Publish the version and complete the upload in a PostgreSQL transaction.
- [ ] Delete quarantine bytes after success and rely on lifecycle cleanup for abandonment.
- [ ] Make all mutating endpoints accept idempotency keys.

### Package, version, ACL, and share APIs

- [ ] Implement package creation and version publication under a stable package identity.
- [ ] Implement package details and paginated version history.
- [ ] Implement organization and selected-user access management.
- [ ] Implement durable share creation with optional pinned version and expiry.
- [ ] Implement share resolution with authenticated metadata preview.
- [ ] Implement immediate share revocation for new grant requests.
- [ ] Implement Cloud package/version deletion with retention and reference checks.
- [ ] Implement version update lookup and rollback selection.

### Download grants

- [ ] Implement `POST /v1/skill-shares/<share-id>/download-grants` after fresh ACL evaluation.
- [ ] Generate a five-minute V4 signed GET URL for the exact immutable key and stored generation.
- [ ] Set only response content type and safe attachment filename overrides.
- [ ] Grant no list or write capability.
- [ ] Return expected archive identity and byte count beside the grant for runtime verification.
- [ ] Test revocation immediately blocks new grants while already issued URLs expire within five
      minutes.

### Cloud tests

- [ ] Test organization, user, pinned-link, expiry, and revocation ACL behavior.
- [ ] Test membership removal between preview, grant, and download.
- [ ] Test expired, reused, wrong-tenant, wrong-key, wrong-size, and wrong-hash uploads.
- [ ] Test malformed, oversized, and resource-exhausting archives during finalization.
- [ ] Test finalization semaphore saturation and retry behavior.
- [ ] Test concurrent idempotent mutations and partial database/GCS failures.
- [ ] Test deduplication without cross-tenant timing or response disclosure.
- [ ] Test quota and rate limits.
- [ ] Test durable shares resolving intended latest and pinned immutable versions.
- [ ] Test update, rollback, revocation, deletion, soft-delete recovery, and orphan reconciliation.

## 8. Implement desktop Cloud client and UX

### Cloud client

- [ ] Add typed calls for upload grants, GCS upload, finalization, package/version catalog,
      ACL/access management, share creation/resolution/revocation, and download grants.
- [ ] Keep desktop contracts storage-provider-neutral.
- [ ] Implement bounded progress, cancellation, retry, and idempotency behavior.
- [ ] Redact signed policies, URLs, credentials, private paths, and package contents at creation.

### Share experience

- [ ] Read and apply `docs/STYLEGUIDE.md`; use canonical CSS tokens and shadcn primitives.
- [ ] Add **Share skill** to eligible installed and workspace skills.
- [ ] Show name, description, author, organization, file count, total size, scripts, and executable
      files before upload.
- [ ] Let the author choose organization or selected-person access.
- [ ] Accept optional release label and notes.
- [ ] Package the exact previewed bytes and invalidate preview after source drift.
- [ ] Show bounded upload and finalization progress with cancellation.
- [ ] Return a copyable durable Orca URL after publication.
- [ ] Add access editing, version publishing, unshare, and package deletion actions.
- [ ] Make clear that unsharing blocks future installs but does not remove installed copies.

### Install experience

- [ ] Show authenticated author, organization, description, version, digest, file summary, scripts,
      and executable files.
- [ ] Treat the package as code from its author and require an explicit install action.
- [ ] Show current-machine global installation as the default.
- [ ] Allow selection of connected machine, Git worktree, or plain folder workspace.
- [ ] Show detected-agent coverage and canonical/provider topology before commit.
- [ ] Show installed-state conflicts and explicit resolution choices.
- [ ] Show phase progress without exposing grants or local private paths.
- [ ] Render installed, unchanged, updated, partial, conflict, unsupported, cancelled, and failed
      results with actionable recovery.
- [ ] Add incomplete-coverage retry.

### Skills page lifecycle

- [ ] Show installed package/version identity and update availability.
- [ ] Offer clean update, modified-copy choices, prior-version rollback, and safe local removal.
- [ ] Show whether a package came from Orca Cloud and its accessible version history.
- [ ] Refresh discovery and installation state after local or remote actions.
- [ ] Keep Cloud deletion, share revocation, and local removal clearly separate.

### UX validation

- [ ] Test keyboard shortcuts and labels with platform-aware macOS versus Windows/Linux behavior.
- [ ] Test loading, error, cancellation, partial, conflict, and stale-preview states.
- [ ] Test screen-reader names, focus order, progress announcements, and destructive confirmations.
- [ ] Test long names, release notes, paths, organization names, and localized copy.
- [ ] Review trust and privacy wording with security and design.

## 9. Implement paired runtime installation

### Runtime and IPC surface

- [ ] Register preview, install, update, and remove through runtime RPC and desktop IPC.
- [ ] Add bounded `beginUpload`, `uploadChunk`, `commitUpload`, and `cancelUpload` methods.
- [ ] Route every request to the runtime that owns the selected host and workspace.
- [ ] Keep transfer separate from installation so grants, relayed chunks, and local files converge
      at the validated ingress boundary.
- [ ] Make upload sessions bounded by count, total bytes, idle lifetime, and chunk size.
- [ ] Require monotonic offsets and idempotent acknowledged-chunk retry or full restart.
- [ ] Release staging bytes after cancellation, disconnect, timeout, and runtime restart.

### Direct and client-mediated transfer

- [ ] Prefer destination-runtime direct download when it can reach approved Orca Cloud storage.
- [ ] Verify origin, redirects, generation, byte count, archive hash, and package digest on the
      destination runtime.
- [ ] Fall back to authenticated client-mediated chunk transfer when the host cannot reach GCS.
- [ ] Never pass the desktop's local path as a remote package source.
- [ ] Preserve the same inspection, transaction, provenance, and result behavior for both
      transports.
- [ ] Test connection loss and resumption or restart behavior at every transfer boundary.

### Mixed versions

- [ ] Hide or disable remote install when `skills.install.v1` is absent.
- [ ] Show a specific host-update-required message instead of attempting the RPC.
- [ ] Test new client/old server and old client/new server.
- [ ] Test optional-field omission in both directions.
- [ ] Test a capability changing after preview but before execution.
- [ ] Confirm older servers retain skill discovery and ignore no unknown stream opcode because none
      is introduced.

## 10. Validate native Windows and WSL on `windows 2`

The connected Orca environment `windows 2` was reachable on 2026-08-11 and ran Orca `1.4.180`.
Read-only discovery found a native Windows Git checkout at `C:\Users\neil\orca\orca` and a plain
folder workspace at `C:\Users\neil\.claude`. WSL availability and distro inventory still need to
be discovered on the host before execution tests begin.

### Host preparation

- [x] Confirm `windows 2` is saved and reachable through `orca environment list` and
      `orca status --environment "windows 2" --json`.
- [x] Confirm the host provides both a native Git checkout and a native plain folder workspace.
- [ ] Record Windows edition/build, architecture, filesystem type, long-path policy, current user
      home, temp root, antivirus status, and developer-mode/symlink policy without collecting
      secrets.
- [ ] Discover installed WSL version and distros, each distro's running state, default user, home,
      filesystem, and Orca host support.
- [ ] Ensure at least two WSL distros are available or record a reproducible second-distro setup
      for the multi-distro test.
- [ ] Create isolated test skills and destination roots under explicit test workspaces; never use
      production user skill directories for destructive failure injection.
- [ ] Record exact Orca client/server versions and capabilities with each test run.

### Native Windows package and destination tests

- [ ] Package on macOS and install on native Windows; compare manifest and digest.
- [ ] Package on native Windows and install on macOS/Linux; compare identity and executable-mode
      policy.
- [ ] Test global home resolution without constructing the path on the macOS client.
- [ ] Test the discovered Git checkout and plain folder workspace independently.
- [ ] Test path joining, drive prefixes, UNC rejection/handling policy, reserved names, trailing
      dots/spaces, long paths, Unicode normalization, and case collisions.
- [ ] Test source and destination paths containing spaces and non-ASCII characters.
- [ ] Test junction creation succeeds for a detected provider.
- [ ] Force junction denial and verify an independently copied, digest-verified fallback.
- [ ] Test an unowned junction, external link, broken junction, and provider parent that is already
      linked.
- [ ] Test copy-fallback drift during update and removal.
- [ ] Hold destination files open to simulate antivirus/indexer contention and verify bounded
      `EPERM`, `EACCES`, and `EBUSY` rename retries.
- [ ] Verify retry exhaustion restores the old version and yields an actionable result.
- [ ] Terminate the runtime before and after each journal boundary and verify startup recovery.
- [ ] Test permission-denied, read-only, disk-full, cancellation, runtime disconnect, and partial
      provider-coverage paths.

### WSL tests

- [ ] Execute package ingress, extraction, home resolution, installation, provenance, and discovery
      inside the selected distro.
- [ ] Prove the Windows client never constructs a Linux home or mutates the distro through a
      translated Windows path.
- [ ] Test global installs for at least two distros with different default users/homes.
- [ ] Test Linux case sensitivity and executable modes inside each distro.
- [ ] Test a distro-owned Git worktree and plain folder workspace.
- [ ] Test a workspace on the distro filesystem and document behavior for `/mnt/c` separately.
- [ ] Test provider detection and POSIX alias creation inside the distro.
- [ ] Test concurrent native Windows and WSL installs of the same package without provenance or
      lock collision across host identities.
- [ ] Test distro stopped, distro removed, default user changed, home moved, and runtime restarted
      between preview and install.
- [ ] Block outbound GCS access inside WSL and verify client-mediated chunk transfer.
- [ ] Disconnect the macOS client during transfer and commit; verify bounded cleanup and recovery.

### Windows/WSL mixed-version tests

- [ ] Use `windows 2` as old host with a newer client and verify capability-gated UI.
- [ ] Upgrade `windows 2` only through the normal supported update path, then test an older client
      against the newer host.
- [ ] Verify folder-workspace IDs, runtime-owned paths, and results survive client/host version
      skew.
- [ ] Capture structured test evidence without signed URLs, tokens, skill contents, or private
      absolute paths beyond approved test fixtures.

### Windows/WSL release gate

- [ ] Real native Windows passes junction success, junction denial, verified copy fallback,
      antivirus contention, long paths, crash recovery, Git worktree, and folder-workspace tests.
- [ ] Real WSL passes two-distro home ownership, Linux semantics, provider placement, offline-GCS
      fallback, cancellation, and crash recovery tests.
- [ ] All temporary test installations, terminals, workspaces, and packages are removed through
      verified, recoverable cleanup.

## 11. Implement and validate SSH targets

- [ ] Define a host-side installer command that invokes the same installer core and structured
      result contract.
- [ ] Transfer immutable packages through the existing SSH/SFTP provider into bounded private
      staging.
- [ ] Invoke installation on the SSH host so it owns home, path, provider, and filesystem
      resolution.
- [ ] Add capability/version detection for the required host component.
- [ ] If unsupported, offer a package download or explicit command; never install into the
      desktop's home as fallback.
- [ ] Propagate cancellation and clean partial SSH transfers and staging.
- [ ] Test SSH-only macOS, Linux at the supported floor, and Windows where the existing provider
      supports it.
- [ ] Test Git worktree and folder-workspace scope over SSH.
- [ ] Test connection loss during upload, extraction, commit, provenance, and result return.
- [ ] Prove SSH and paired runtimes return the same result and error-category contracts.

## 12. Add observability, operations, and security controls

### Metrics and dashboards

- [ ] Record bounded package byte/file counts and package, upload, finalization, download, transfer,
      install, placement, and recovery durations.
- [ ] Record outcomes by error category, OS, destination kind, transport, conflict type, and
      placement topology.
- [ ] Record junction, alias, copy-fallback, rollback, recovery, capability-absence, and orphan
      reconciliation counts.
- [ ] Add dashboards for grant/finalize/share rates, authorization and rate limits, finalization
      saturation, archive rejection, and digest mismatch.
- [ ] Add Cloud Run 5xx, CPU, memory, instance, and skill-route latency panels and alerts.
- [ ] Add GCS quarantine/published bytes, object count, and lifecycle failure panels and alerts.
- [ ] Add PostgreSQL connection, storage, query latency, migration, and transaction panels and
      alerts.
- [ ] Add signed-policy/URL generation and IAM Credentials failure alerts.
- [ ] Add budget alerts for GCS storage/egress, Cloud Run growth, and Cloud SQL storage.

### Logging and privacy

- [ ] Log package/version IDs, phases, destination labels, placement outcomes, and bounded error
      categories only.
- [ ] Exclude package contents, filenames, manifests, raw local paths, ACL membership, durable share
      URLs, upload policies, download grants, and credentials.
- [ ] Redact sensitive network values before logger invocation, not after ingestion.
- [ ] Audit authorization and lifecycle events without instruction or script contents.
- [ ] Verify diagnostics and support bundles preserve the same exclusions.

### Security review

- [ ] Threat-model package creation, archive ingestion, manifest trust, path containment, local
      conflicts, grants, redirects/SSRF, authorization, tenant isolation, and instruction/script
      trust.
- [ ] Verify owner-private staging permissions on supported hosts.
- [ ] Rate-limit uploads, finalization, downloads, share resolution, and remote transfer sessions.
- [ ] Test malicious redirects, DNS/host confusion, expired grants, mismatched generations, and
      oversized streaming bodies.
- [ ] Test archive and filesystem race conditions, including source drift and destination changes
      after preview.
- [ ] Review organization departure, deletion, retention, soft-delete, and operator recovery.
- [ ] Complete privacy and security sign-off before external rollout.

### Runbooks and kill switches

- [ ] Add independent server-side flags for upload grants, download grants, and remote
      installation.
- [ ] Verify disabling Cloud grants does not break skill discovery or already installed skills.
- [ ] Document finalization saturation, GCS/IAM signing failure, database outage, corrupt package,
      orphan reconciliation, and rollback response.
- [ ] Document coordinated PostgreSQL point-in-time and GCS generation/soft-delete restoration.
- [ ] Document package/share deletion, organization departure, legal retention, and audit handling.
- [ ] Document how and when to split finalization into its own service.

## 13. Complete automated and end-to-end validation

### Transaction matrix

- [ ] Test fresh install, identical reinstall, clean update, rollback, explicit replacement, and
      safe removal.
- [ ] Test modified and unowned canonical and provider conflicts.
- [ ] Test canonical/provider paths as regular files, directories, aliases, junctions, external
      links, and broken links.
- [ ] Test concurrent desktop, headless runtime, CLI, SSH, and recovery attempts.
- [ ] Test permission and read-only failures, disk exhaustion, cancellation, process termination,
      and host disconnect.
- [ ] Test independent-copy drift and incomplete provider coverage.

### Platform and target matrix

- [ ] Run macOS ARM64 and x64 behavior where supported.
- [ ] Run Linux against Ubuntu 20.04/glibc 2.31 and verify bundled native binaries respect the
      floor.
- [ ] Run native Windows and WSL scenarios on `windows 2`.
- [ ] Run local and remote Git worktrees and plain folder workspaces.
- [ ] Run paired runtimes with both client-newer and server-newer combinations.
- [ ] Run supported SSH-only macOS, Linux, and Windows targets.
- [ ] Run a remote target without outbound Cloud connectivity through chunk transfer.

### Required journeys

- [ ] Share on machine A, install globally on machine B, launch a detected agent, and discover the
      skill.
- [ ] Share on machine A, install into a folder workspace on a connected runtime, and discover it
      only in that workspace.
- [ ] Modify installed bytes, publish an update, and prove Orca refuses silent replacement.
- [ ] Disconnect during commit, reconnect, recover, and prove either the old or new version is
      complete.
- [ ] Revoke a share, prove a new install fails, and prove the existing local install remains.
- [ ] Publish a new immutable version, update one machine, leave another pinned, then rollback the
      updated machine.
- [ ] Remove local installation without deleting its Cloud package, then delete/revoke Cloud
      access without mutating another local installation.

### CI and test evidence

- [ ] Add deterministic fixtures authored for Orca without copying upstream fixtures.
- [ ] Add failure-injection hooks available only to tests/development harnesses.
- [ ] Add a CLI-only developer harness for local and remote integration tests.
- [ ] Keep CI commands compatible with macOS, Linux, Windows PowerShell/cmd, and WSL.
- [ ] Archive bounded test results and security evidence without secrets or private contents.
- [ ] Make package safety, transaction recovery, platform, and mixed-version suites required release
      checks.

## 14. Stage and release

### Staging

- [ ] Apply reviewed Terraform and migrations to staging.
- [ ] Deploy `orca-cloud-api` skill routes disabled by server-side flags.
- [ ] Run upload/finalize/download tests for expiry, denial, oversize, corruption, deduplication,
      revocation, deletion, and cleanup.
- [ ] Run desktop-to-local, paired-runtime, `windows 2`, WSL, and SSH journeys in staging.
- [ ] Verify logs, metrics, traces, diagnostics, and support bundles contain no grants or private
      package data.
- [ ] Load-test finalization and choose the fixed semaphore from observed memory, CPU, request
      latency, and database usage.
- [ ] Exercise at least one quarantine lifecycle deletion and published-object soft-delete
      recovery.

### Production infrastructure and internal rollout

- [ ] Apply the approved production Terraform plan and verify no unrelated replacement.
- [ ] Run production database migrations before routing skill traffic.
- [ ] Deploy the API with all skill flags disabled.
- [ ] Enable internal accounts only.
- [ ] Verify one complete share, local install, remote install, update, rollback, revoke, local
      removal, Cloud deletion, upload expiry, and soft-delete recovery journey.
- [ ] Verify upload, download, and remote-install kill switches independently.
- [ ] Review error budgets, cost, authorization denials, saturation, orphan counts, and support
      signals.

### Gradual availability

- [ ] Expand by account/organization cohort with rollback criteria and an on-call owner.
- [ ] Keep upload grants, download grants, and remote installation independently controllable.
- [ ] Pause expansion on unexplained digest mismatch, archive containment failure, data leak,
      unrecoverable local mutation, or cross-tenant authorization defect.
- [ ] Publish user documentation for sharing, access, install destinations, updates, rollback,
      removal, retention, and trust.
- [ ] Publish admin documentation for organization access, user departure, deletion, and retention.
- [ ] Remove rollout flags only after sustained healthy usage and a reviewed decision.

### First-release gate

- [ ] Threat model and privacy review are approved.
- [ ] Cross-platform package and transaction suites are required and green.
- [ ] `windows 2` native Windows and WSL release gates pass on real filesystems.
- [ ] Real SSH paths and host-owned resolution pass.
- [ ] Mixed-version tests pass in both directions.
- [ ] Cancellation and crash recovery pass during transfer and every commit boundary.
- [ ] Durable-share authorization, revocation lag, retention, deletion, and recovery are documented
      and tested.
- [ ] The UI identifies author, organization, scripts, and executable content before install.
- [ ] Telemetry, logs, and diagnostic bundles contain no credentials or private contents.
- [ ] Kill switches are tested without affecting discovery or existing installations.

## 15. Post-release team library and reconciliation

- [ ] Measure sharing, installation, update, conflict, fallback, failure, and multi-machine demand
      without collecting private contents.
- [ ] Design an organization skill library and immutable version history from usage evidence.
- [ ] Add **Install on another machine** and bounded multi-machine progress.
- [ ] Add optional desired-version policy for selected personal or organization machines.
- [ ] Add opt-in drift and missing-install reconciliation that never overwrites modifications.
- [ ] Evaluate an explicit, reviewable project desired-state manifest.
- [ ] Evaluate direct machine-to-machine transfer if Cloud persistence is not appropriate.
- [ ] Define offline convergence without durable shared credentials.
- [ ] Document organization removal, user departure, package retention, and reconciliation
      semantics before enabling policy-driven installs.
