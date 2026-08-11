# Agent skill sharing and installation plan

Status: implementation and validation in progress.

Last updated: 2026-08-11.

Implementation checklist:
[Agent skill sharing implementation checklist](./agent-skill-sharing-implementation-checklist.md).

Architecture decision:
[Agent skill sharing upstream boundary](./reference/agent-skill-sharing-upstream-boundary.md).

Provider registry:
[Agent skill provider paths](./reference/agent-skill-provider-paths.md).

## Decision summary

Orca will own a focused skill packaging and installation pipeline for private sharing.

The community [`vercel-labs/skills`](https://github.com/vercel-labs/skills) project will
remain a behavioral reference, not a runtime dependency or source donor. Its npm package
exposes a CLI rather than a supported programmatic API, and its install/update behavior does
not provide the transaction, provenance, or private-package semantics Orca needs.

Orca will:

1. Package a local skill into an immutable, content-addressed artifact.
2. Store private artifacts behind Orca Cloud authorization and durable share records.
3. Resolve a share into a short-lived download grant after checking access.
4. Execute installation on the machine that will use the skill.
5. Validate, stage, commit, and verify the package without silently overwriting local work.
6. Install once into `.agents/skills` and add aliases only for detected agents that need
   provider-specific paths.
7. Record Orca-owned provenance independently from the community CLI's lockfiles.

The first release will support Orca package sources only. Arbitrary Git, npm, and community
registry sources remain delegated to existing tools until there is a product need to own
that larger package-manager surface.

## Current execution status

Orca implementation through `8be6301811` and Orca Cloud implementation through `81a581d` are
pushed on feature branches without an Orca pull request. Local, Windows, WSL, paired-runtime, and
Docker-backed SSH validation are substantially complete; the implementation checklist records the
exact evidence and remaining physical-host and failure-recovery gates.

The dedicated staging bucket, IAM, secret container, metrics, dashboard, and alerts exist in
`onorca-cloud-staging`. Staging Cloud SQL is shared with Auth and Relay and is intentionally
stopped. Review a fresh Terraform plan after refreshing `gcloud` authentication, then wake staging
only through the supported Relay power workflow if the reviewed skill changes require the
database. Keep skill routes disabled until migrations and staging smoke tests pass.

## Research baseline

The upstream assessment used `vercel-labs/skills` commit
`c6f69c631292444cc541ac6d91e2226b0ff247da`.

Useful upstream behavior:

- A canonical `.agents/skills/<name>` location.
- A data set of agent-specific global and project paths.
- Relative symlink handling, Windows junction behavior, and copy fallback.
- Archive path, entry-count, and extracted-byte limits.
- Tests for aliases, broken links, and provider-specific placement.

Behavior Orca will not inherit:

- Deleting the destination before the replacement is ready.
- Updating without checking whether installed files were modified.
- Direct read/modify/write lockfile updates without durable publication.
- Reinstalling the canonical directory once per selected agent.
- Treating an expiring signed artifact URL as package identity.
- Coupling installation to prompts, terminal output, telemetry, and process exits.

Orca will not copy upstream source, tests, fixtures, or registry entries. Provider paths will be
implemented independently from official provider documentation and verified installations. Under
that constraint, Orca does not incorporate upstream copyrightable material and needs no upstream
attribution. Revisit this decision if implementation work ever proposes copying material.

## Goals

- Share a private skill with a teammate through a durable, intuitive link.
- Install on the local computer or any compatible connected Orca runtime.
- Support global scope and folder-workspace/project scope.
- Work on macOS, Linux, and Windows.
- Preserve executable bits and all files in the skill package.
- Prevent archive traversal, symlink escapes, special files, case collisions, and resource
  exhaustion.
- Never silently replace an unowned or locally modified skill.
- Recover from interruption during package download, extraction, placement, alias creation,
  or provenance publication.
- Keep share authorization separate from short-lived blob access.
- Support immutable versions, updates, removal, and eventual team-wide reconciliation.
- Remain compatible with independently updated desktop clients and remote Orca servers.
- Treat ordinary folder workspaces as first-class; Git is not required.

## Non-goals for the first release

- Reimplementing all `skills` CLI source parsing and provider integrations.
- Supporting all upstream agent paths on day one.
- Publishing private package bytes through a public bearer URL.
- Automatically installing a shared skill on every organization machine.
- Merging local modifications with a newer shared package version.
- Treating installation as a security sandbox. A skill contains instructions and scripts and
  must be presented to the user as code from its author.
- End-to-end encryption from Orca Cloud operators in the initial trust model. Private means
  access-controlled to authorized Orca users and organizations. Application-level package
  encryption can be added later without changing package identity.

## Product experience

### Sharing

The user opens an installed or workspace skill and chooses **Share skill**.

Orca shows:

- Skill name and description.
- Package file count and total size.
- Included scripts and executable files.
- Current author identity and organization.
- Access choice: organization or selected people.
- Optional version label and release notes.

After confirmation, Orca validates and packages the exact bytes shown in the preview, uploads
them, and returns a durable URL such as:

```text
https://app.orca.dev/skills/share/<share-id>
```

The URL identifies a revocable share record, not a blob-storage object or bearer grant. Every
recipient still authenticates and passes the share ACL. Revocation, organization membership
changes, version selection, and audit history therefore remain effective after the link has been
copied.

### Installing

Opening a share shows:

- Author and organization.
- Skill description, version, file summary, and package digest.
- Whether an installed skill with the same name already exists.
- Destination machine.
- Global or workspace scope.
- Detected agents that will receive coverage.
- Any conflict that requires a decision.

The default action installs on the current machine globally. Connected machines and folder
workspaces are selectable. The action reports one of:

- Installed.
- Already installed.
- Updated.
- Installed with incomplete agent coverage.
- Needs a conflict decision.
- Unsupported because the selected runtime must be updated.

The UI must follow `docs/STYLEGUIDE.md` and use existing design tokens and shadcn primitives.

## Target architecture

```text
Skill folder
    |
    v
Package builder -- validates and creates immutable artifact
    |
    v
Orca Cloud -- private blob + version metadata + ACL + durable share
    |
    v
Download grant -- short-lived and scoped to one immutable digest
    |
    v
Destination runtime
    |
    +-- package ingress
    +-- package inspection
    +-- install planning
    +-- staged transaction
    +-- provider placement reconciliation
    +-- provenance publication
    +-- post-install discovery
```

Cloud download, client-mediated transfer, and a local package file all terminate at the same
validated package-ingress boundary. Installation logic does not know which transport supplied
the bytes.

## Package format

Use a versioned tar archive so executable modes can be represented without a platform-specific
side channel. The archive contains an envelope rather than placing Orca metadata inside the
installed skill:

```text
manifest.json
skill/
  SKILL.md
  scripts/
  references/
  assets/
```

Conceptual manifest:

```ts
type SkillPackageManifestV1 = {
  schemaVersion: 1
  packageId: string
  versionId: string
  name: string
  description: string
  createdAt: string
  files: Array<{
    path: string
    size: number
    executable: boolean
    sha256: string
  }>
  packageDigest: string
}
```

Rules:

- `packageId` is stable across versions; `versionId` identifies one immutable publication.
- `packageDigest` is derived from normalized paths, executable state, classification, and file
  identity using Orca's existing skill-package identity rules.
- `skill/SKILL.md` is required and must parse successfully.
- The installed folder receives only the contents of `skill/`.
- Paths use `/` in the manifest and are converted with the executing host's path API.
- LF and CRLF non-executable text share one normalized package identity, while each immutable
  archive retains and hashes its exact source bytes; executable and binary files always use exact
  bytes for identity.
- Names are normalized once during publication. Installation never silently renames a conflict.
- V1 rejects symlinks and special files. A later package-builder feature may safely dereference
  internal links after proving they remain within the source root.
- Existing limits remain the starting contract: depth 16, 2,048 entries, 512 files, 4 MiB per
  file, and 32 MiB total extracted bytes. Compressed download size also receives an explicit cap.
- Archive and manifest schema changes are additive or introduced as a new schema version.

The package builder observes the source, copies it into a private staging directory, observes
the staged copy again, and only packages it if the two identities agree. The preview shown to
the user is bound to that final digest.

## GCP deployment plan

### Existing production baseline

Read-only inspection of the active `onorca-cloud` project on 2026-08-11 found:

| Resource          | Existing state relevant to skill sharing                                                                                                                                   |
| ----------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Cloud Run         | `orca-cloud-api`, `orca-cloud-auth`, `orca-cloud-relay`, and `orca-cloud-relay-fence` run in `us-central1`                                                                 |
| API service       | `orca-cloud-api` uses its own service account, scales from 0 to 20 instances, has a 300-second timeout, and already owns artifact-sharing endpoints                        |
| Object storage    | `onorca-cloud-artifacts` is a `US` bucket with uniform bucket-level access, public-access prevention, exact CORS for `https://share.onorca.dev`, and seven-day soft delete |
| Database          | `orca-cloud-auth-db` is PostgreSQL 17 in `us-central1`, regional/high-availability, with backups and point-in-time recovery                                                |
| Database contents | The instance currently contains `orca_auth` and `orca_relay` databases; there is no skill database                                                                         |
| IAM               | `orca-cloud-api@onorca-cloud.iam.gserviceaccount.com` owns objects in the existing artifact bucket                                                                         |
| APIs              | Cloud Run, Cloud Storage, Cloud SQL Admin, IAM Credentials, Secret Manager, Logging, Monitoring, and Pub/Sub are enabled                                                   |
| Excluded services | Firestore and Cloud Asset Inventory are disabled; Cloud Tasks is not enabled                                                                                               |

The GCP inspection was read-only. Commands that offered to enable disabled APIs were declined, and
no resources or IAM policies were changed.

### V1 infrastructure decision

Use the existing project, API service, authentication service, PostgreSQL instance, deployment
pipeline, and Terraform state. Add a dedicated package bucket and database instead of putting
private skill packages into the existing general artifact namespace.

The V1 control plane remains in `orca-cloud-api`. Package validation is bounded and streaming, so a
separate worker service is not justified at the initial 40 MiB compressed-package ceiling. Protect
the existing API workload with a small per-instance package-finalization semaphore and return a
retryable response when that lane is full.

Split package processing into a dedicated Cloud Run service later if finalize latency or CPU usage
interferes with artifact sharing. Do not reduce the entire API service's current concurrency merely
to accommodate one endpoint family.

Firestore is not required. Skill metadata belongs in PostgreSQL beside the existing Orca Cloud
identity model. Cloud Tasks and Pub/Sub are not required for V1 because upload expiry is enforced
by a GCS lifecycle rule and package finalization stays synchronous and bounded.

### Required GCP changes

All production changes are declared in the existing Orca Cloud Terraform configuration. Do not
create durable resources manually with `gcloud`.

| Change              | Proposed production value                                                                                                     |
| ------------------- | ----------------------------------------------------------------------------------------------------------------------------- |
| GCS bucket          | `onorca-cloud-skill-packages`, subject to Terraform name validation                                                           |
| Location            | `US`, matching existing shared-artifact storage; revisit per-region buckets when data residency becomes a product requirement |
| Access              | Uniform bucket-level access and public-access prevention enforced                                                             |
| Soft delete         | Seven days, matching the current artifact bucket                                                                              |
| Object versioning   | Disabled; package keys are immutable and GCS generations are recorded                                                         |
| Temporary lifecycle | Delete `uploads/` objects after one day                                                                                       |
| CORS                | Exact approved Orca share/app origins; no wildcard origin                                                                     |
| Database            | `orca_skills` on `orca-cloud-auth-db`                                                                                         |
| Database principal  | Dedicated `orca_skills_app` user with access only to `orca_skills`                                                            |
| Database secret     | `orca-cloud-skills-database-url` in Secret Manager                                                                            |
| Cloud Run service   | Extend `orca-cloud-api`; mount the existing Cloud SQL instance and inject only the skill database secret                      |
| Package signer      | Reuse `orca-cloud-api@onorca-cloud.iam.gserviceaccount.com` for V1                                                            |
| Metrics/logging     | Extend existing Cloud Logging and Monitoring configuration with skill endpoint dashboards and alerts                          |

The bucket is separate because skill packages need different authorization, retention, signed
download, and lifecycle rules from public/shared artifacts. It also provides a clean IAM kill
switch without disrupting existing artifact links.

### Bucket layout

```text
gs://onorca-cloud-skill-packages/
  uploads/<upload-id>/package.tar.gz
  packages/v1/sha256/<first-two-hex>/<archive-sha256>/package.tar.gz
```

Rules:

- `uploads/` is quarantine storage and is never downloadable through a share.
- Upload IDs are random, single-use, tenant-bound, and expire in PostgreSQL as well as GCS.
- Final package keys are derived from the validated archive SHA-256.
- The database records the final object's GCS generation, compressed size, archive SHA-256, and
  package digest.
- Final objects are never overwritten. Promotion uses a generation-match precondition.
- If a final key already exists, finalization verifies its archive SHA-256 and logical package
  digest metadata before reusing it.
- Internal deduplication never changes tenant-scoped API responses or reveals that another
  organization already stored the same digest.
- GCS object versioning remains off; immutable keys plus stored generations prevent accidental
  replacement, while seven-day soft delete provides operator recovery.
- Deleting the final database reference deletes the object only after a transaction proves no
  package version still references it. GCS soft delete then supplies the recovery window.

### Upload implementation

Use a V4 signed POST policy rather than a signed unrestricted PUT. The POST policy enforces:

- Exact quarantine object key.
- `application/vnd.orca.skill+tar+gzip` content type.
- A content-length range capped at 40 MiB.
- Required upload ID and expected archive SHA-256 metadata.
- A 15-minute expiration.

The compressed limit is slightly above the 32 MiB extracted-file limit to allow tar metadata and
incompressible input. The package builder still enforces the lower extracted-content limits.

Upload sequence:

1. `orca-cloud-api` authenticates the user through the existing auth integration.
2. The API checks organization membership, package quota, per-user rate limits, and concurrent
   upload limits.
3. It inserts a pending upload row and returns a signed POST policy for the unique quarantine key.
4. The client uploads directly to GCS; package bytes do not traverse Cloud Run.
5. The client calls finalize with the upload ID and package manifest identity.
6. The API reads GCS object metadata and rejects unexpected size, content type, key, generation,
   or tenant binding.
7. The API streams the object once to calculate archive SHA-256 and validate the archive envelope,
   manifest, path set, file limits, and package digest. It never buffers the whole package.
8. The API promotes the validated object to its immutable content-addressed key with an
   if-absent generation precondition.
9. A PostgreSQL transaction publishes the immutable package version and marks the upload complete.
10. The quarantine object is deleted. The one-day lifecycle remains the backstop for abandoned
    uploads.

Run at most a small fixed number of finalizations concurrently per API instance. A full lane
returns `429` or `503` with `Retry-After`; it does not queue unbounded package bytes or work.

### Download grants

After resolving a share and rechecking its ACL, `orca-cloud-api` creates a V4 signed GET URL with:

- Exact final object key and stored generation.
- Five-minute expiration.
- Response content type and attachment filename.
- No list or write permission.

The URL is the short-lived grant. The durable share URL is never signed directly and cannot access
GCS. Revocation cannot invalidate an already-issued GCS URL, so the five-minute lifetime is the
maximum revocation delay.

The destination runtime accepts download URLs only from the configured GCS origin for the Orca
skill bucket, rejects credential-bearing redirects to any other host, enforces the expected byte
count while streaming, and verifies both archive SHA-256 and package digest before installation.

### IAM

Apply least privilege at the dedicated bucket and service-account level:

- Grant the API service account `roles/storage.objectUser` on the skill-package bucket, not a
  project-wide storage role.
- Grant the API service account `roles/cloudsql.client` for the existing instance.
- Allow the API service account to use IAM Credentials `signBlob` for itself so it can generate V4
  policies and URLs without a downloaded service-account key. The Terraform binding is scoped to
  that service account.
- Grant Secret Manager accessor only for `orca-cloud-skills-database-url` and any future
  skill-specific secret.
- Keep bucket IAM free of `allUsers` and `allAuthenticatedUsers`.
- Do not give the desktop, remote runtime, or user identity direct bucket IAM. They receive only a
  time-bound signed operation after application authorization.
- Keep the existing deployment service account's impersonation/deploy permissions unchanged
  except where Terraform needs to manage the new resources.

No long-lived GCP key is shipped in Orca or stored on a remote runtime.

### PostgreSQL schema

Create migrations for:

- `skill_packages`: stable package identity, owner organization, slug/name, creator, timestamps,
  and deletion state.
- `skill_package_versions`: immutable version, package digest, archive SHA-256, GCS object key and
  generation, byte counts, manifest JSON, release notes, creator, and publication state.
- `skill_package_uploads`: tenant/user binding, quarantine key and generation, expected identities,
  expiration, finalization state, and failure category.
- `skill_package_acl`: organization or user principal, permission, creator, and timestamps.
- `skill_share_records`: unpredictable share ID, package ID, optional pinned version, expiration,
  revocation state, creator, and timestamps.
- `skill_package_audit_events`: bounded security/lifecycle event metadata without package contents
  or signed URLs.

Required constraints and indexes include:

- Unique package slug within its owning organization.
- Unique immutable version ID and package digest identity.
- Unique final GCS object key/generation pair.
- Share lookup by unpredictable ID and active/revoked state.
- ACL lookup by package and principal.
- Pending-upload lookup by owner and expiration.
- Foreign keys that prevent removing a blob reference while a published version uses it.

Every share resolution, grant, update lookup, and revoke mutation begins with an authenticated
principal and evaluates package ownership plus ACL in the same request. The share ID locates the
record but does not itself authorize access.

### Cloud Run changes

Add skill endpoints to `orca-cloud-api` and configure:

```text
ORCA_SKILL_PACKAGE_BUCKET=onorca-cloud-skill-packages
ORCA_SKILL_PACKAGE_MAX_COMPRESSED_BYTES=41943040
ORCA_SKILL_PACKAGE_UPLOAD_TTL_SECONDS=900
ORCA_SKILL_PACKAGE_DOWNLOAD_TTL_SECONDS=300
ORCA_SKILL_PACKAGE_FINALIZE_CONCURRENCY=<small fixed value>
ORCA_SKILLS_DATABASE_URL=<Secret Manager reference>
```

Use the existing auth base URL and CORS-origin configuration. Do not add a second authentication
implementation for skills.

The API streams upload validation with fixed buffers under its existing 512 MiB memory limit. Load
test the finalize lane before choosing its fixed concurrency. Keep the current Cloud Run instance
scaling bounds initially, then adjust only from observed CPU, latency, database connection, and
error metrics.

Recommended endpoint family:

```text
POST   /v1/skill-packages/uploads
POST   /v1/skill-packages/uploads/<upload-id>/finalize
POST   /v1/skill-packages
GET    /v1/skill-packages/<package-id>
GET    /v1/skill-packages/<package-id>/versions
POST   /v1/skill-packages/<package-id>/shares
DELETE /v1/skill-shares/<share-id>
GET    /v1/skill-shares/<share-id>
POST   /v1/skill-shares/<share-id>/download-grants
```

Finalize may create the package/version in one call; the separate package endpoint remains useful
when publishing a new version under an existing stable package identity. All mutating endpoints
accept idempotency keys.

### CORS and public routing

- Route the endpoint family through the existing Orca Cloud API hostname and deployment path.
- Add only exact production and approved development app/share origins to the skill bucket's CORS
  policy.
- Allow `POST` for signed upload policy submission and `GET`/`HEAD` for signed download.
- Expose only required response headers such as `Content-Type`, `Content-Length`, `ETag`,
  `x-goog-generation`, and `x-goog-hash`.
- Do not expose the GCS bucket through a public custom domain.
- Keep Cloud Run ingress and authentication consistent with existing API endpoints; package
  authorization remains mandatory at the application layer.

### Retention, deletion, and recovery

- Pending upload database rows expire after 15 minutes and are safe to delete after one day.
- GCS deletes quarantine objects after one day regardless of database cleanup success.
- Published objects have no age-based deletion rule.
- Package deletion first marks metadata deleted and revokes shares, then deletes an object only
  when no retained version references it.
- Seven-day GCS soft delete allows operator recovery from accidental object deletion.
- PostgreSQL backups and point-in-time recovery cover metadata; restoration procedures must restore
  database rows and object generations consistently.
- Organization retention and legal deletion requirements override product rollback retention.

### Monitoring and operational gates

Add dashboards and alerts for:

- Upload grant, finalize, share resolution, and download-grant request rate.
- Authorization denials and rate-limit outcomes.
- Finalize duration, semaphore saturation, archive rejection category, and digest mismatch.
- Cloud Run 5xx rate, CPU, memory, instance count, and request latency for skill routes.
- GCS quarantine bytes, published bytes, object count, and lifecycle deletion failures.
- PostgreSQL connection count, storage, query latency, migration status, and failed transactions.
- Signed URL creation failures and IAM Credentials errors.
- Orphan metadata/object reconciliation count.

Budget alerts cover GCS stored bytes and egress, Cloud Run CPU/request growth, and Cloud SQL storage.
Logs contain package/version IDs and error categories, not manifests, filenames, share URLs, signed
policies, signed URLs, or ACL membership.

### Provisioning and deployment sequence

1. Confirm the existing Orca Cloud Terraform worktree and staging environment are current.
2. If there is no isolated staging GCP project, create or designate one before testing package
   upload; do not exercise new lifecycle/IAM behavior first in `onorca-cloud` production.
3. Add the bucket, lifecycle, CORS, IAM, database, database user, secret, Cloud SQL attachment, API
   configuration, dashboards, alerts, and budget thresholds to Terraform.
4. Run Terraform formatting, validation, and a reviewed plan. The expected production plan contains
   no replacement of the existing artifact bucket, Cloud SQL instance, or Cloud Run services.
5. Apply in staging and run upload/finalize/download tests, including expired policies, ACL denial,
   oversized uploads, corrupt archives, deduplication, revocation, and object cleanup.
6. Apply the PostgreSQL migrations before routing package traffic to the new API handlers.
7. Deploy `orca-cloud-api` with endpoints disabled by a server-side feature flag.
8. Run a staging desktop-to-runtime installation and verify logs contain no grants or private
   contents.
9. Apply the reviewed production Terraform plan.
10. Run migrations, deploy the API, and enable internal accounts only.
11. Observe at least one complete soft-delete, upload-expiry, update, rollback, and revoke journey.
12. Expand the feature flag gradually, retaining separate kill switches for upload grants,
    download grants, and remote installation.

Production verification uses read-only commands such as:

```bash
gcloud storage buckets describe gs://onorca-cloud-skill-packages --project=onorca-cloud
gcloud run services describe orca-cloud-api --region=us-central1 --project=onorca-cloud
gcloud sql databases list --instance=orca-cloud-auth-db --project=onorca-cloud
gcloud iam service-accounts get-iam-policy \
  orca-cloud-api@onorca-cloud.iam.gserviceaccount.com --project=onorca-cloud
```

Never print Secret Manager payloads or signed policies/URLs during verification.

## Installation scopes and destinations

### Global scope

The canonical root is resolved on the destination host:

```text
<home>/.agents/skills/<skill-name>
```

Provider-specific aliases are created only for detected agents that do not consume the canonical
root.

### Workspace scope

The canonical root is:

```text
<workspace>/.agents/skills/<skill-name>
```

The workspace may be a Git worktree or a plain folder. Resolution uses the workspace identity
owned by the executing runtime; a client-provided path alone is not trusted for a remote target.

Project installation does not create or modify a checked-in desired-state lockfile in V1. A
separate team-sync feature may later add an explicit, reviewable project manifest.

### WSL scope

WSL is a distinct execution target. Home resolution, path operations, package extraction, and
installation run inside the selected distro. The Windows client must not construct Linux home
paths or mutate the distro through translated Windows paths.

### SSH-only scope

An SSH target without an Orca runtime cannot execute the runtime RPC directly. Before GA, add a
host-side installation command invoked through the existing SSH execution and file-transfer
providers. The desktop uploads the immutable package through SFTP, invokes the bundled Orca
installer on the SSH host, and receives the same structured result as runtime RPC.

If the required host component is unavailable, Orca reports the limitation and provides a local
package download or command; it never installs into the desktop's home as a fallback.

## Provider destination strategy

Orca owns a small data-only registry for agents Orca supports. Each entry describes:

- Orca agent ID.
- Whether it reads the universal `.agents/skills` root.
- Global provider-specific path resolver when required.
- Project provider-specific path resolver when required.
- Detection evidence required before creating the path.
- Supported alias mechanism by platform.

The registry is authored from official agent documentation and Orca's own verified installations.
Upstream may reveal that a compatibility case exists, but its implementation, path table, and
tests are not copied or transformed into Orca code.

Policy:

1. Always create one canonical copy.
2. Do nothing else for universal agents.
3. Create an alias for a detected non-universal agent.
4. On Windows, prefer a directory junction when supported.
5. Fall back to a verified independent copy only when aliases are unavailable.
6. Record every placement and its topology.
7. Never create configuration roots for dozens of undetected agents.
8. Never replace an unowned provider-specific copy without an explicit decision.

Provider releases and official documentation are reviewed periodically. Orca's registry changes
only through normal review and platform tests; no upstream synchronization script owns it.

## Installer components

Create narrow modules with explicit responsibilities:

### Shared contracts

- `src/shared/skill-package-manifest.ts`: package manifest schema and canonical validation.
- `src/shared/skill-install-contract.ts`: request, preview, conflict, placement, and result types.
- `src/shared/skill-install-capability.ts`: runtime capability name and compatibility message.

### Main/runtime implementation

- `src/main/skills/skill-package-creation.ts`: source observation, stable staging, and archive
  creation.
- `src/main/skills/skill-package-extraction.ts`: bounded archive inspection and extraction.
- `src/main/skills/skill-package-download.ts`: grant validation, host allowlisting, streaming, and
  compressed-byte limits.
- `src/main/skills/skill-install-destinations.ts`: global, workspace, WSL, and provider path
  resolution.
- `src/main/skills/skill-provider-destinations.ts`: Orca-owned provider registry.
- `src/main/skills/skill-install-planner.ts`: current-state inspection and conflict decisions.
- `src/main/skills/skill-install-transaction.ts`: locking, staging, commit journal, rollback, and
  recovery.
- `src/main/skills/skill-placement-reconciliation.ts`: aliases, junctions, and verified copy
  fallback.
- `src/main/skills/skill-install-provenance.ts`: bounded receipts and recovery data.
- `src/main/skills/skill-install-service.ts`: orchestration and structured results.

Reuse `observeSkillPackage` and the existing topology/freshness logic directly. Reuse the design
of plugin staging, provenance, lock serialization, and Windows rename retries, but do not import
plugin-domain modules into the skill domain. Promote a primitive only when both domains can name
and test the same contract accurately.

### Cloud client

- Skill upload grant creation and finalization.
- Share creation, resolution, revocation, and access management.
- Download grant creation.
- Package catalog and version lookup.
- Manager-only package details include current user/organization access and active, unexpired
  share records; non-managers never receive that management metadata.

Exact files follow the repository that owns Orca Cloud APIs; desktop contracts stay provider
neutral.

### Runtime and IPC

- Extend the existing skill RPC registration with preview/install/update/remove methods.
- Register the same operations through desktop IPC.
- Route every request to the runtime that owns the selected machine and workspace.
- Keep package transfer separate from installation so direct download and chunked relay converge
  on one staged file.

### Renderer

- Share preview and access dialog.
- Share completion dialog with copyable durable link.
- Access editing, active-link revocation, immutable-version deletion, and Cloud-package deletion
  with explicit confirmation and copy explaining that installed copies remain local.
- Install preview with destination, scope, coverage, and conflict state.
- Install progress and structured outcome.
- Installed version, update, removal, and incomplete-coverage actions on the Skills page.

## Install request and result contract

Conceptual request:

```ts
type SkillInstallRequest = {
  operationId: string
  package: {
    packageId: string
    versionId: string
    packageDigest: string
    compressedBytes: number
  }
  ingress:
    | { kind: 'download-grant'; url: string; expiresAt: string }
    | { kind: 'staged-upload'; uploadId: string }
    | { kind: 'local-file'; path: string }
  destination:
    | { scope: 'global'; environmentId?: string }
    | { scope: 'workspace'; worktreeId?: string; folderWorkspaceId?: string }
  conflictResolution?: 'replace-unmodified' | 'replace-and-discard-local' | 'cancel'
}
```

`local-file.path` is accepted only across an in-process trusted boundary. It is not exposed as an
arbitrary remote RPC path.

Conceptual result:

```ts
type SkillInstallResult = {
  operationId: string
  status: 'installed' | 'updated' | 'unchanged' | 'conflict' | 'partial' | 'failed'
  name: string
  packageDigest: string
  canonicalPath?: string
  placements: Array<{
    provider: string
    path: string
    topology: 'canonical-copy' | 'provider-alias' | 'independent-copy'
    status: 'installed' | 'unchanged' | 'skipped' | 'failed'
    errorCategory?: string
  }>
  conflict?: {
    kind: 'modified' | 'unowned' | 'external-link' | 'name-collision'
    existingDigest?: string
  }
  errorCategory?: string
}
```

The response never includes a download grant or credentials.

## Installation algorithm

### 1. Admission

- Validate all request fields and package identifiers.
- Resolve the destination through host-owned runtime state.
- Confirm the requested scope is writable and contained in an allowed home or workspace root.
- Reject an expired grant before network access.
- Deduplicate retries using `operationId` and the package/destination identity.

### 2. Lock

- Acquire a cross-process lock scoped to canonical destination and skill name.
- Use an atomic lock-directory or exclusive-file creation supported on all target platforms.
- Record a random owner token and start time.
- Recover a stale lock only after validating its journal and owner liveness policy.
- Bound lock wait time and return a retryable busy result.

An in-process promise chain alone is insufficient because the desktop, headless runtime, CLI, or
SSH helper may run concurrently.

### 3. Ingress

- Stream the archive into a bounded temporary file.
- For grants, require HTTPS when the configured cloud endpoint is HTTPS and restrict redirects and
  final hosts to approved Orca storage origins.
- Abort when compressed bytes exceed the manifest contract.
- Hash while streaming and compare the archive identity supplied by Cloud.
- Delete partial bytes on cancellation, expiration, disconnect, or failure.

### 4. Extract and inspect

- Create extraction staging on the same filesystem as the canonical destination.
- Reject absolute paths, `..`, drive prefixes, NUL bytes, links, devices, FIFOs, sockets,
  encrypted entries, duplicate normalized paths, and case-fold collisions.
- Enforce compressed, extracted, entry, file, depth, and per-file limits during extraction.
- Validate `manifest.json` before trusting file metadata.
- Observe `skill/` with `observeSkillPackage` and compare every file and the package digest.
- Parse `SKILL.md` and require its identity to agree with the package name.

### 5. Inspect current state

Classify the canonical destination and all requested provider placements.

Canonical outcomes:

- Missing: install is allowed.
- Same requested digest: no-op; continue to placement repair.
- Matches Orca receipt and remains unmodified: update is allowed.
- Differs from its Orca receipt: return a modified conflict.
- Exists without Orca provenance: return an unowned conflict.
- External or broken link: return a topology conflict.

Provider outcomes:

- Correct alias or matching Orca-owned fallback copy: no-op.
- Missing: create after canonical commit.
- Broken Orca-owned alias: repair.
- Unowned or modified placement: leave untouched and report incomplete coverage unless the user
  explicitly chooses replacement.

The preview and final install repeat current-state inspection. A state change between preview and
commit invalidates the preview and requires a new decision.

### 6. Prepare commit

- Copy extracted `skill/` into a hidden sibling staging directory.
- Preserve executable modes.
- Observe the copy and require the expected digest again.
- Write a durable transaction journal before moving the current destination.
- Keep the replacement and backup on the destination filesystem so directory renames do not cross
  volumes.

### 7. Commit canonical copy

- If an existing destination is approved for replacement, rename it to the journal's backup path.
- Rename the verified staging directory into the canonical path.
- Use bounded Windows retry behavior for antivirus/indexer `EPERM`, `EACCES`, and `EBUSY` races.
- Observe the installed path and require the requested digest.
- On failure, restore the backup and retain enough journal state for startup recovery.

Directory replacement is crash-recoverable rather than assumed to be a single atomic overwrite on
every platform.

### 8. Reconcile provider placements

- Create aliases relative to their real parent directory on POSIX.
- Use directory junctions with absolute targets on Windows.
- Detect parent directories that are already symlinked to canonical storage.
- If an alias mechanism fails, create and verify an independent copy when policy allows.
- Reconcile each placement idempotently.

Canonical success is retained when one provider placement fails. The result is `partial`, and the
UI offers retry. Rolling back a valid universal installation because one optional alias failed
would make recovery less reliable.

### 9. Publish provenance

Write a bounded, versioned receipt outside the installed skill folder containing:

- Package and version IDs.
- Expected package digest.
- Scope and destination identity.
- Canonical path identity.
- Provider placements and topologies.
- Previous version identity for interrupted-update recovery.
- Installation timestamp and Orca host/runtime identity.

Do not store credentials, download URLs, share bearer values, or package contents.

Serialize receipt updates, write them durably through a temporary file and rename, and support
reconstruction from per-install provenance if the aggregate index is corrupt.

After the receipt is durable, mark the journal complete and delete transactional backups and
staging bytes.

### 10. Verify and publish result

- Run skill discovery on the destination target.
- Confirm the canonical skill and successful provider placements are observable.
- Return observed status and error categories rather than relying on process exit alone.
- Invalidate renderer skill caches and refresh the Skills page.

## Update behavior

1. Resolve the latest accessible immutable version from Cloud.
2. Compare its digest with the receipt.
3. Observe installed bytes before offering the update.
4. If bytes match the receipt, use the normal installation transaction.
5. If bytes were modified, offer:
   - Keep local version.
   - Publish local bytes as a new immutable version when exactly one non-missing Orca-managed
     install matches the skill name and scope; Cloud rechecks ownership of that stable package ID.
   - Replace and discard local changes after explicit confirmation.
6. Reconcile all recorded aliases and fallback copies.
7. Preserve the previous package version in Cloud; rollback is a normal install of that immutable
   version.

Do not invoke `npx skills update` for Orca-owned packages or write entries that cause the community
CLI to claim ownership of them.

## Removal behavior

1. Read Orca provenance and observe every recorded placement.
2. Remove only aliases that still point to the recorded canonical path.
3. Remove independent copies only when their bytes still match their recorded digest, unless the
   user explicitly confirms discarding modifications.
4. Remove the canonical copy only when it is Orca-owned, unmodified, and no retained placement or
   receipt depends on it.
5. Publish the provenance change durably.
6. Leave an unowned or changed destination untouched and report what remains.

Cloud package deletion and local removal are separate actions. Revoking a share prevents new
downloads but does not silently delete already installed local files.

## Remote, SSH, and mixed-version compatibility

Add a static runtime capability:

```text
skills.install.v1
```

Clients check it before sending installation RPCs. Older servers continue supporting discovery
but do not show remote install actions. A missing capability produces an update-required message.

Adding new RPC methods and a static capability does not require a runtime protocol bump. New
fields remain optional until all supported peers understand them. No new terminal stream opcode is
needed.

Recommended RPC surface:

- `skills.install.preview`
- `skills.install.beginUpload`
- `skills.install.uploadChunk`
- `skills.install.commitUpload`
- `skills.install.cancelUpload`
- `skills.install.execute`
- `skills.install.update`
- `skills.install.remove`

Upload sessions are bounded by count, bytes, idle lifetime, and chunk size. Offsets are monotonic;
retries either repeat an acknowledged chunk idempotently or restart the upload. Disconnect and
cancellation release staging bytes.

The runtime that executes installation owns:

- Home and config-directory resolution.
- Workspace/folder identity resolution.
- WSL distro selection.
- Agent detection and provider paths.
- Filesystem mutation and recovery.

The calling client owns:

- User authentication and share authorization.
- Destination selection.
- Obtaining a grant or providing package chunks.
- Rendering preview, progress, conflicts, and results.

## Security and privacy controls

The detailed threat register and residual release gates live in
[`docs/reference/agent-skill-sharing-threat-model.md`](./reference/agent-skill-sharing-threat-model.md).

- Treat `SKILL.md` and packaged scripts as executable code for trust messaging.
- Show author, organization, version, digest, file summary, and executable files before install.
- Require authentication for private share resolution and every download grant.
- Bind grants to one package version, digest, maximum byte count, and short expiration.
- Validate grant and redirect hosts to prevent server-side request forgery.
- Never execute package scripts during installation.
- Reject links and special files before they can be published or extracted.
- Keep package staging owner-only where platform permissions support it.
- Avoid logging file contents, share tokens, signed URLs, or organization-private names.
- Audit authorization and lifecycle events without storing skill contents in telemetry.
- Apply organization deletion and retention policy to metadata and blobs.
- Rate-limit uploads, downloads, share resolution, and remote transfer sessions.
- Use constant-shape authorization failures so private package existence is not disclosed.

## Failure and recovery model

The transaction journal records enough state to classify interrupted operations:

- Download only: delete partial archive.
- Extracted but not committed: delete staging.
- Existing destination moved to backup: restore backup.
- New destination placed but receipt absent: verify new digest, then either finish receipt
  publication or restore backup according to journal state.
- Receipt published but journal incomplete: verify receipt and installed digest, then finalize.
- Alias reconciliation interrupted: preserve canonical installation and retry reconciliation.

Recovery runs before a new operation for the same destination and during bounded startup cleanup.
It never removes an unknown path based only on a filename pattern; the journal owner token,
destination containment, and expected identities must all agree.

## Testing strategy

### Package tests

- Deterministic manifest and digest generation.
- Source changes during packaging.
- CRLF/LF identity behavior.
- Executable mode preservation.
- Missing or malformed `SKILL.md`.
- Excessive depth, entries, files, individual size, total size, and compressed size.
- Traversal, absolute paths, Windows drive paths, Unicode/case collisions, duplicate paths,
  symlinks, hardlinks, devices, FIFOs, sockets, and encrypted entries.
- Truncated and checksum-invalid archives.

### Transaction tests

- Fresh install, identical reinstall, clean update, and explicit replacement.
- Modified and unowned conflicts.
- Existing canonical or provider paths that are files, directories, links, or broken links.
- Failure before and after every journal transition.
- Backup restoration and idempotent recovery.
- Concurrent desktop, runtime, and CLI attempts.
- Cancellation during download, extraction, copy, commit, and alias reconciliation.
- Antivirus-style Windows rename contention.
- Permission failures and read-only destinations.
- Alias failure with verified copy fallback.
- Independent copy drift during update and removal.

### Target matrix

- macOS ARM64 and x64 behavior where available.
- Linux at the supported Ubuntu 20.04/glibc 2.31 floor.
- Windows with junction success, junction denial, copy fallback, and long paths.
- WSL with multiple distros and distro-owned home resolution.
- Local Git worktree and plain folder workspace.
- Paired remote runtimes in both client-newer and server-newer combinations.
- SSH-only macOS/Linux/Windows targets where supported by existing providers.
- Remote target with no outbound Cloud connectivity using chunked transfer.

### Cloud tests

- Organization/user/link ACLs and revocation.
- Expired grants and membership removed between preview and download.
- Upload finalization digest mismatch.
- Blob deduplication without cross-tenant information leakage.
- Quota and rate-limit behavior.
- Durable share resolving to the intended immutable version.
- Version update and rollback.

### End-to-end journeys

1. Share on machine A, install globally on machine B, launch a detected agent, and discover the
   skill.
2. Share on machine A, install into a folder workspace on a connected remote runtime, and discover
   it only in that workspace.
3. Modify the installed copy, publish an update, and prove Orca refuses silent replacement.
4. Disconnect during commit, reconnect, recover, and obtain either the complete old or complete
   new version.
5. Revoke a share, prove new installation fails, and prove an existing local installation remains.

## Observability

Record bounded operational metrics:

- Package byte/file counts and stage durations.
- Download versus client-mediated transfer selection.
- Install outcomes by category.
- Conflict categories.
- Alias, junction, and copy-fallback rates.
- Recovery and rollback counts.
- Runtime capability absence.
- Error categories by operating system and target kind.

Do not record skill contents, file names beyond approved aggregate categories, private share URLs,
download grants, access lists, or raw local paths.

User-facing logs show phase, destination label, placement outcome, and actionable error. Sensitive
network values are redacted at creation rather than scrubbed after logging.

## Delivery phases

### Phase 0: contracts and vertical spike

Deliver:

- Package manifest schema.
- Local package builder and bounded extractor.
- A programmatic install call from a validated staging directory into a temporary canonical root.
- Fresh install and modified-conflict tests on macOS, Linux, and Windows CI.
- Decision record confirming upstream is behavioral-reference-only and no material is copied.

Exit criteria:

- No `npx` or Node installation dependency outside Orca's own runtime.
- Same bytes produce the same digest on every target platform.
- Invalid archive classes fail before destination mutation.

Estimate: 2–3 engineer-days for the spike, followed by design review.

### Phase 1: production local installer

Deliver:

- Cross-process lock.
- Durable journal and recovery.
- Canonical install, update, and removal.
- Provenance receipts and aggregate index recovery.
- Provider registry for Orca's primary detected agents.
- POSIX aliases, Windows junctions, and verified copy fallback.
- Structured preview/result contracts.
- CLI-only developer harness for deterministic integration tests.

Exit criteria:

- Failure injection at every commit boundary preserves either the previous or requested complete
  package.
- Local modifications are never silently replaced.
- Folder workspaces and global scope pass the platform matrix.

Estimate: 5–8 engineer-days.

### Phase 2: private Cloud sharing

Deliver:

- Reviewed Terraform for the dedicated private GCS bucket, lifecycle, CORS, bucket-scoped IAM,
  service-account signing, `orca_skills` database, database secret, Cloud SQL attachment,
  monitoring, and budgets.
- PostgreSQL migrations for package, version, upload, ACL, share, and audit records.
- Upload/finalize APIs using bounded V4 signed POST policies and private content-addressed GCS
  objects.
- Version, ACL, share, revocation, five-minute download grant, quota, and audit behavior.
- Share preview and access UI.
- Install preview and local-machine installation UI.
- Durable links and short-lived grants.
- Update availability and version rollback.

Exit criteria:

- A copied durable link remains inaccessible unless the authenticated recipient passes the share
  ACL.
- Revocation immediately blocks new grants.
- The installed receipt identifies the immutable package without persisting a grant.
- Production provisioning changes are Terraform-owned and do not replace existing artifact,
  Cloud SQL, or Cloud Run resources.

Estimate: 1–2 engineer-weeks across desktop and Cloud work.

### Phase 3: paired Orca runtime installation

Deliver:

- `skills.install.v1` capability.
- Runtime preview/install/update/remove methods.
- Direct runtime download.
- Bounded client-mediated upload fallback.
- Destination-machine and remote-workspace selection.
- Mixed-version UI and compatibility tests.

Exit criteria:

- Installation executes on the selected host and uses that host's home, workspace, and detected
  agents.
- Older hosts are not called and receive a clear update-required state.
- A host without outbound internet installs through the authenticated chunked transfer path.

Estimate: 4–7 engineer-days.

### Phase 4: WSL and SSH completion

Deliver:

- Distro-owned package ingress and installer execution.
- SSH package upload and host-side structured installer invocation.
- Cross-target cancellation and cleanup.
- WSL/SSH provider detection and path coverage.
- Real-host end-to-end coverage.

Exit criteria:

- No desktop path is substituted for a WSL, SSH, or runtime path.
- SSH and WSL return the same result contract as native installation.
- Failure and cancellation leave no untracked staging bytes outside bounded recovery retention.

Estimate: 4–7 engineer-days, depending on host-helper availability.

### Phase 5: team library and reconciliation

Deliver:

- Organization skill library and version history.
- “Install on another machine” and multi-machine progress.
- Optional desired-version policy for selected personal or organization machines.
- Drift and missing-install reconciliation.
- Explicit project desired-state manifest if validated by product usage.
- Direct machine-to-machine transfer as an alternative to Cloud persistence if required.

Exit criteria:

- Reconciliation remains opt-in and never overwrites local modifications.
- Offline machines converge after reconnect without sharing durable credentials.
- Organization removal, user departure, and package retention have documented semantics.

Estimate: separate product milestone after first-release usage data.

## Release gates

Before enabling Cloud or remote installation by default:

- Threat-model review covers package ingestion, grants, SSRF, archive extraction, local path
  containment, and instruction/script trust.
- Cross-platform CI covers the package and transaction suites.
- Real Windows validates junction and copy fallback.
- Real WSL and SSH validate host-owned paths.
- Mixed-version remote tests cover old client/new server and new client/old server.
- Download/upload cancellation and app/runtime crash recovery are exercised.
- Telemetry and diagnostic bundles are verified not to contain grants or private contents.
- Share deletion, revocation, organization departure, and retention behavior are documented.
- The UI identifies the author and executable content before installation.
- A kill switch can disable new Cloud grants and remote installs without affecting discovery or
  already installed skills.

## Effort summary

For one engineer familiar with Orca:

| Scope                               |                                     Estimate |
| ----------------------------------- | -------------------------------------------: |
| Disposable canonical-copy prototype |                                     1–2 days |
| Production local installer          |                                     5–8 days |
| Cloud sharing and local install UX  |                                    1–2 weeks |
| Paired runtime support              |                                     4–7 days |
| WSL and SSH completion              |                                     4–7 days |
| Polished first release              |             Approximately 3–5 engineer-weeks |
| Full community CLI parity           | 6–10 weeks plus ongoing registry maintenance |

The recommended first release ends after Phase 4. Phase 5 should follow observed demand rather
than delaying private sharing for organization-wide policy features.

## Implementation principles

- One validated installer core, regardless of source or destination transport.
- One canonical copy, with provider placements reconciled separately.
- Immutable Cloud versions and mutable local installations are distinct concepts.
- A durable share is authorization metadata, not a permanent blob URL.
- Installed bytes, not child-process exit codes, determine success.
- Unknown or modified local state fails closed.
- Remote hosts own their paths and mutations.
- Upstream behavior informs compatibility but does not define Orca's internal architecture.
