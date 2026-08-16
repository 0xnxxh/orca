#!/usr/bin/env python3
"""Mutation harness for the STA-4363 review: revert a load-bearing production
line, run the guarding suites, and report whether they actually go RED."""
import subprocess, sys, re, os

ROOT = "/home/brennan/orca/workspaces/orca/review-4363"
SHARED = "src/shared/native-chat-image-transcript-markers.ts"
LIFECYCLE = "src/main/native-chat/transcript-turn-lifecycle.ts"
DECODER = "src/main/native-chat/transcript-line-decoders-claude.ts"
WIRE = "src/shared/native-chat-image-source-wire.ts"
RPC = "src/main/runtime/rpc/methods/native-chat.ts"
MRECON = "mobile/src/session/mobile-native-chat-draft-reconcile.ts"
MECHO = "mobile/src/session/mobile-native-chat-pending-echo.ts"
MRETIRE = "mobile/src/session/mobile-native-chat-pending-retirement.ts"

MUTATIONS = [
    ("M1 core anchoring: strip markers on every plain user turn again", SHARED,
     "const blocks = removeEmptyFirstTextBlock(message.blocks)",
     "const blocks = stripImagePromptMarkersFromTextBlocks(message.blocks)"),
    ("M2 source-first fold: accept any marker count", SHARED,
     "countImagePromptMarkers(prompt) === sources.paths.length",
     "countImagePromptMarkers(prompt) > 0"),
    ("M3 prompt-first fold: accept any source count", SHARED,
     "if (sources.paths.length === markerCount) {",
     "if (sources.paths.length > 0) {"),
    ("M4 match text: always strip markers from the echo key", SHARED,
     "return hasImages ? normalizeNativeChatUserText(text) : normalizeLiteralNativeChatUserText(text)",
     "return normalizeNativeChatUserText(text)"),
    ("M5 lifecycle: drop the isMeta/isSynthetic guard", LIFECYCLE,
     "  if (record.isMeta === true || record.isSynthetic === true || record.isCompactSummary === true) {\n    return null\n  }\n",
     ""),
    ("M6 decoder: never retain Claude image-source metadata", DECODER,
     "    ? retainImageSourceMetadata && isImageSourceRecord(decodedBlocks)",
     "    ? false && isImageSourceRecord(decodedBlocks)"),
    ("M7 wire: skip legacy projection for un-negotiated peers", WIRE,
     "  return negotiatedCapability === NATIVE_CHAT_IMAGE_SOURCE_RUNTIME_CAPABILITY\n    ? (messages as NativeChatMessage[])\n    : normalizeLegacyNativeChatImageTranscriptMessages(messages)",
     "  void negotiatedCapability\n  void normalizeLegacyNativeChatImageTranscriptMessages\n  return messages as NativeChatMessage[]"),
    ("M8 rpc: emit empty appended frames again", RPC,
     "          if (sanitized.length > 0 || lifecycle) {",
     "          if (true) {"),
    ("M9 mobile preview echo: one marker vouches for N images", MRECON,
     "        (countImagePromptMarkers(message) >= entry.images!.length &&",
     "        (countImagePromptMarkers(message) > 0 &&"),
    ("M10 mobile pending key: strip markers from the pending text", MECHO,
     "      pendingMatchText(pending) === origin.normalizedText &&",
     "      normalizeNativeChatUserText(pending.text) === origin.normalizedText &&"),
    ("M11 mobile retirement: key landed turns on the stripped text", MRETIRE,
     "    const text = nativeChatUserMessageMatchText(message)\n    if (text) {\n      landedCounts.set(text, (landedCounts.get(text) ?? 0) + 1)",
     "    const text = normalizedNativeChatUserMessageText(message)\n    if (text) {\n      landedCounts.set(text, (landedCounts.get(text) ?? 0) + 1)"),
]

ROOT_FILTERS = ["src/shared/native-chat", "src/main/native-chat/", "src/renderer/src/components/native-chat/",
                "src/main/runtime/rpc/methods/native-chat"]
MOBILE_FILTERS = ["src/session/"]


def run(cmd, cwd):
    p = subprocess.run(cmd, cwd=cwd, shell=True, capture_output=True, text=True)
    return p.returncode, p.stdout + p.stderr


def failing_tests(out):
    names = set()
    for line in out.splitlines():
        m = re.match(r"\s*(?:FAIL|×|✗)\s+(.*)", line.strip())
        if m:
            names.add(m.group(1).strip()[:160])
    return sorted(names)


def main():
    only = sys.argv[1] if len(sys.argv) > 1 else None
    for label, path, old, new in MUTATIONS:
        if only and not label.startswith(only):
            continue
        full = os.path.join(ROOT, path)
        src = open(full).read()
        if old not in src:
            print(f"### {label}\n  SKIPPED — anchor not found in {path}\n")
            continue
        open(full, "w").write(src.replace(old, new, 1))
        try:
            rc_r, out_r = run("pnpm vitest run --config config/vitest.config.ts " + " ".join(ROOT_FILTERS), ROOT)
            rc_m, out_m = run("pnpm --dir mobile exec vitest run --config vitest.config.ts " + " ".join(MOBILE_FILTERS), ROOT)
        finally:
            open(full, "w").write(src)
        red = rc_r != 0 or rc_m != 0
        print(f"### {label}")
        print(f"  file: {path}")
        print(f"  ROOT   exit={rc_r}  MOBILE exit={rc_m}  ->  {'RED (test caught it)' if red else 'GREEN — VACUOUS, nothing caught this'}")
        for n in failing_tests(out_r)[:12]:
            print(f"    root  × {n}")
        for n in failing_tests(out_m)[:12]:
            print(f"    mob   × {n}")
        print()


main()
