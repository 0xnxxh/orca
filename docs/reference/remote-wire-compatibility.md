# Remote wire compatibility

Orca's remote-server feature pairs a desktop client to a remote Orca runtime, and
users update the two independently. **Mixed versions are the normal state**, not an
edge case. This page is the contract for changing anything a paired client and host
exchange: the runtime RPC envelope, the terminal binary stream, and the content
either side publishes over them.

`src/shared/protocol-version.ts` says when to bump `RUNTIME_PROTOCOL_VERSION`. This
page covers the changes that do _not_ bump it and are therefore easy to get wrong.

## Rule 1 — a new optional JSON field on an existing frame is safe

Every JSON payload is parsed with a decoder that ignores unknown keys (zod `.strip()`
on RPC params, `JSON.parse` on stream frames). An older peer that has never heard of
the field simply does not read it.

Safe:

```ts
// host adds a field; older clients ignore it
encodeTerminalStreamJson({ kind, cols, rows, hiddenOutputReason })
```

**The field is safe only for as long as every reader treats it as optional.** The
moment a newer client _requires_ it, that client is broken against every host that
predates the field — which is the same defect as removing a field, just discovered
later. If new behavior depends on the field being present, that is Rule 2: negotiate
it, or make the reader fall back.

## Rule 2 — a new stream opcode is NOT safe; negotiate it

`decodeTerminalStreamFrame` returns `null` for an opcode it does not know, and
`runtime-rpc.ts` drops that frame without an error:

```ts
const frame = decodeTerminalStreamFrame(bytes)
if (!frame) {
  return // silently dropped — the sender never learns
}
```

So a new opcode sent to an older peer does not fail loudly. It vanishes, and the
feature behind it appears to hang. Input sent under a new opcode is swallowed.

A new opcode must be announced in the subscribe handshake and sent only after the
peer confirms it. The existing pattern is `SetOutputPaused` (opcode 16):

- the client advertises support in the `Subscribe` frame's `capabilities`;
- the host echoes `capabilities: { outputPause: 1 }` on the `subscribed` event;
- the client sends opcode 16 only after that echo (`stream.supportsOutputPause`);
- the host only acts on opcode 16 when it negotiated it (`stream.supportsOutputPause`).

`OutputSpan` (opcode 15) is the worked example, and it is worth reading closely because
the obvious fix was wrong on half the paths.

It shipped ungated in v1.4.147 (2026-07-19) on both the legacy `terminal.subscribe`
stream and the multiplex stream, so transformed emissions (SSH relay, startup ingress,
daemon keep-tail salvage) reached mobile as an opcode its vendored table does not
contain — dropped with no error, no banner, no retry. On `terminal.subscribe` it is now
gated on `capabilities.outputSpan`, and a sender that has not been told the peer can
decode a span **downgrades to plain `Output`** rather than sending nothing.

On `terminal.multiplex` it is deliberately **not** gated. Two reasons, and both
generalise:

**A capability cannot retroactively prove incapability.** The gate keys off the peer
declaring `outputSpan`, a flag no shipped build sends. Opcode 15 predates every
capability a multiplex peer could declare — `ackOutput` by 9 days, `ackOutputSourceRanges`
by 10 — so "did not declare it" is indistinguishable between a build from before the
opcode and the entire installed base from after it. Since mixed versions are the normal
state, a gate added after an opcode ships reads the whole fleet as incapable.

**A fallback is only a fallback if it is lossless for that peer.** A plain `Output`
frame carries `(data, seq)` and nothing else, so the receiver can only reconstruct a run
as `seq - data.length`. A transformed run has `rawLength !== data.length` by definition.
Downgrading it to `Output` therefore cannot be made correct for a peer that tracks
`seq`, and the desktop multiplex client does: it head-blocks the ack queue on a
zero-byte frame, reads a false dropped-frame gap on every transformed emission, and
detaches the stream when a >48 KiB run flips the source-range ledger's mapping mode.
The downgrade works on `terminal.subscribe` for exactly one reason — mobile ignores
Output `seq` entirely — and that fact, not the capability flag, is what licenses it.

So: for an opcode carrying user-visible data, "don't send it" is still data loss, and a
gate needs a fallback that preserves the payload. But check what the fallback frame can
actually express for the peer you are aiming it at before you reach for one, and prefer
gating at the point where the new opcode was genuinely new rather than adding a gate to
a path where it has already shipped.

### Mobile vendors its own opcode table

`mobile/` is a separate pnpm workspace, so
`mobile/src/transport/terminal-stream-protocol.ts` has historically held a **hand-copied**
enum knowing only 1-6 and 12. Adding an opcode to the shared file did not add it to
mobile, and nothing failed — not typecheck, not lint, not the cross-version harness,
which pairs desktop builds only. The two tables drifted silently by construction.

`terminal-subscribe-output-span-capability.test.ts` now parses mobile's real source and
forces an explicit per-opcode decision, so a new opcode is neither "mobile decodes it"
nor "gated" until someone says which. Until mobile shares the table outright, treat
every mobile-reachable opcode above 12 as unsupported unless the stream negotiated it.

Reuse an existing opcode with a new optional payload field (Rule 1) whenever that
expresses the change; reach for a new opcode only when framing genuinely differs.

Opcode numbers are permanent. See the `Ack = 13` and `ClaimViewport = 14` comments
in `src/shared/terminal-stream-protocol.ts` for why a shipped number cannot be
reused even if the feature behind it is removed.

## Rule 3 — changing what the host publishes breaks old clients with no wire change

The frame shape can be untouched and the skew still real, because clients react to
frame _content_. PR #12641 is the worked example: the host stopped synthesizing a
finished agent status, and clients running older code saw different content in an
identical frame.

Treat these as wire changes even though nothing in the codec moves:

- a field the host stops populating (an old client reading it now sees `undefined`);
- a value whose meaning, units, or nullability changes;
- content the host stops synthesizing, trims, or starts deriving from a new source;
- a frame the host stops sending, or starts sending, on an existing path.

If old clients cannot interpret the new projection correctly, gate it behind a
runtime capability the same way Rule 2 gates an opcode.

## Enforcement

`tests/e2e/cross-version-wire/cross-version-terminal-wire.unit.test.ts` runs the real
host RPC methods and the real renderer multiplexer from two builds against each
other — current working tree against the newest release tag, in both skew
directions — over one scripted terminal journey (subscribe, input, hide/reveal
snapshot, drop, reconnect).

Run it with:

```bash
pnpm exec vitest run --config config/vitest.config.ts tests/e2e/cross-version-wire/cross-version-terminal-wire.unit.test.ts
```

It fails when a frame is refused by the receiving build's decoder (Rule 2), when the
observed frame sequence changes (Rule 3), or when published snapshot content or
negotiated capabilities differ from the contract. Adding an optional field keeps it
green (Rule 1); making a client depend on that field turns the new-client/old-host
pairing red.

The harness covers the terminal stream only. It does **not** cover the session-tab
sync channel, agent-session publications, file or Git RPCs, mobile/E2EE framing, or
the relay transport. A change on those paths still needs its own reasoning against
the three rules above.
