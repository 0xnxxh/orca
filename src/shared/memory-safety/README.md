# Memory safety

Shared primitives that stop unbounded memory growth. Renderer OOM is Orca's dominant crash class
(#9984): heap climbs to V8's ~3.5 GB ceiling and the process is killed. The reported reproduction
(#9872) was a single unbounded `Map` that also spread-copied itself on every update.

**Read this before adding a new limit, and before writing code that reads or accumulates data.**

## The rule: bound at ingress, not in the interior

Put a ceiling where untrusted or unpredictably-large data first enters memory:

- **Files** — anything read from disk, a repo, or a remote host
- **Transport** — IPC, WebSocket frames, relay/SSH payloads, subprocess output
- **Parsing** — JSON/YAML/CSV/notebook text, base64, image headers
- **Enumeration** — directory walks, provider pagination, session scans
- **Long-lived accumulators** — caches and maps keyed by something a user can grow without limit
  (pane IDs, session IDs, paths) that live for the process lifetime

Do **not** add ceilings to interior data structures whose size is already implied by a bounded
input. A second ceiling behind an existing one is not defense in depth; it is a second thing that
can be wrong, and every ceiling is a new user-visible failure mode when it is hit.

If you cannot name the untrusted input and the bound it crosses, you do not need a limit.

### Never copy an accumulator on every update

The crash that started this (#9872) was not only an unbounded `Map` — it also rebuilt itself on every
status ping (`state = { ...state, [key]: value }`). Copy-per-update turns a large collection into
repeated large allocations, so it reaches the heap ceiling far sooner than its size suggests. Mutate
in place, or use `BoundedMap`. No lint rule catches this; it is on you to notice.

## What's here

| Module                           | Use it for                                                                                |
| -------------------------------- | ----------------------------------------------------------------------------------------- |
| `bounded-map.ts`                 | A cache/map that must not grow forever. Count and/or byte ceiling with LRU eviction.      |
| `node-bounded-file-reader.ts`    | Reading a file whose size you do not control. Checks before allocating and while growing. |
| `node-bounded-json-stringify.ts` | Serializing to JSON when the result could be huge.                                        |
| `bounded-secure-json-file.ts`    | Writing a secret-bearing JSON file within a byte ceiling.                                 |
| `json-text-structure-limit.ts`   | Guarding `JSON.parse` against depth/token amplification before it runs.                   |
| `utf8-byte-limits.ts`            | Measuring/truncating UTF-8 without materializing the whole string.                        |

Domain-specific ceilings (e.g. `git-status-limit.ts`, `terminal-scrollback-limits.ts`) live next to
the code they bound, not here. This folder is only for primitives reused across domains.

## Rules for a new ceiling

1. **Set it far above real use.** A limit a normal user reaches is a bug. Ordinary large repos, long
   terminal sessions, and big diffs must pass untouched. State the headroom in a comment.
2. **Fail closed, and never crash a remote host.** An unmeasurable size rejects the item; it must not
   poison a ledger or throw into a relay running on someone else's machine.
3. **Decide overload behavior explicitly** — reject, evict, or truncate — and document which.
   Silent truncation of user data is the worst option; prefer a visible, recoverable failure.
4. **Release on every exit path**, including throw, abort, disconnect, and renderer teardown. Pair
   acquisition with `try`/`finally`; do not rely on the happy path.
5. **Test the exact boundary and boundary+1**, through every entry point — including hydration,
   restore, and replay paths, not just the create path.

## The ratchet (`pnpm run check:bounded-ingress`)

Runs in `pnpm lint`. It scans `src/` and `mobile/src/` for five unbounded-ingress patterns —
`readFile`/`readFileSync`, `response.text()/.json()/.arrayBuffer()/.blob()`, `JSON.parse`,
`JSON.stringify`, and `Promise.all|allSettled|any(x.map(...))` — and fails when a **file's count for
a rule exceeds its baseline count** in `config/bounded-ingress-baseline.json`.

Two ways to pass when it flags you:

1. **Use a helper** from this folder. This is the default; the failure message names the exact export.
2. **Justify it** with a `bounded-by:` comment on the line or the line above, naming what actually
   bounds it — `// bounded-by: stat-checked < 1 MiB above`. An empty `bounded-by:` is rejected, and
   the token only counts inside a comment.

**Do not grow the baseline.** `--update-baseline` exists to _shrink_ it as unbounded reads are
replaced, and to re-seed after a large refactor — not to admit new ones.

What it does **not** enforce: `createReadStream`, `readdir`, recursion depth, copy-per-update
amplification, and long-lived accumulator growth. Those are doctrine, not lint; the rules above still
apply to them. `JSON.stringify` is in the list not as ingress but because serializing a large object
transiently doubles it.

## Before you add one

Prefer fixing the actual growth. The real crash was fixed by capping one map that was already known
to grow, found via the heap-highwater breadcrumbs in `renderer_memory_highwater` (#9984). Measure
first: if you cannot point at evidence that something grows, a new ceiling is speculation, and
speculation here costs review burden, user-visible failure modes, and code that outlives its reason.
