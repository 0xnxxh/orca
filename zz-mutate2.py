#!/usr/bin/env python3
import runpy, sys, os
sys.argv = ["zz-mutate.py"]
mod = {}
exec(open("/home/brennan/orca/workspaces/orca/review-4363/zz-mutate.py").read().replace("main()\n", "", 1), mod)

SHARED = mod["SHARED"]; MRECON = mod["MRECON"]; MECHO = mod["MECHO"]; MRETIRE = mod["MRETIRE"]
POCC = "src/renderer/src/components/native-chat/native-chat-pending-occurrence.ts"
MDRAFTS = "mobile/src/session/use-mobile-native-chat-drafts.ts"
SEED = "mobile/src/session/use-mobile-native-chat-launch-draft-seed.ts"

mod["MUTATIONS"] = [
    ("M12 mobile pending-echo: drop the image-count lane guard", MECHO,
     "      (origin.imageCount > 0\n        ? (pending.images?.length ?? 0) >= origin.imageCount\n        : !pending.images?.length) &&",
     "      true &&"),
    ("M13 mobile retirement: look up landed counts with markers stripped", MRETIRE,
     "        : (landedCounts.get(nativeChatUserTextMatchText(item.text, false)) ?? 0) >=",
     "        : (landedCounts.get(nativeChatUserTextMatchText(item.text, true)) ?? 0) >="),
    ("M14 mobile retirement: let image turns into the literal landed-count lane", MRETIRE,
     "    if (message.blocks.some(isImageRefBlock)) {\n      continue\n    }\n",
     ""),
    ("M15 shared: drop removeEmptyFirstTextBlock (identity)", SHARED,
     "const blocks = removeEmptyFirstTextBlock(message.blocks)",
     "const blocks = message.blocks"),
    ("M16 desktop pending key: strip markers from the send key", POCC,
     "  const text = nativeChatPendingMatchText(pending)",
     "  const text = normalizeNativeChatPendingText(pending.text)"),
    ("M17 desktop content key: drop the image-count namespace", POCC,
     "  return imageCount > 0 ? `text:${text}\\0images:${imageCount}` : `text:${text}`",
     "  void imageCount\n  return `text:${text}`"),
    ("M18 desktop content keys: let image turns claim the literal key", POCC,
     "  if (matchText && !hasImageRefs) {",
     "  if (matchText) {"),
    ("M19 desktop glue: let image sends be represented by user text", POCC,
     "      (entry) => !entry.hasImages && !represented.has(entry.index) && entry.text.length > 0",
     "      (entry) => !represented.has(entry.index) && entry.text.length > 0"),
    ("M20 mobile preview migration: any marker count picks the prompt", MRECON,
     "        countImagePromptMarkers(candidate) === sourceCount",
     "        countImagePromptMarkers(candidate) > 0"),
    ("M21 mobile occurrence count: drop the image-evidence floor", MRECON,
     "      nativeChatUserMessageImageEvidenceCount(message) >= imageCount",
     "      true"),
    ("M22 mobile preview echo (captioned): drop the image-count floor", MRECON,
     "          normalizedNativeChatUserMessageText(message) === targetText &&\n          imageCount >= entry.images!.length",
     "          normalizedNativeChatUserMessageText(message) === targetText &&\n          true"),
    ("M23 mobile glue: let image turns supply glue text", MRETIRE,
     "    const text = message.blocks.some(isImageRefBlock)\n      ? null\n      : nativeChatUserMessageMatchText(message)",
     "    const text = nativeChatUserMessageMatchText(message)"),
    ("M24 mobile captureSendOrigin: always key with markers stripped", MDRAFTS,
     "      const normalizedText = nativeChatUserTextMatchText(text, imageCount > 0)",
     "      const normalizedText = nativeChatUserTextMatchText(text, true)"),
    ("M25 mobile launch-draft seed: revert to stripped user text (site 1)", SEED,
     "    if (messages.some((message) => nativeChatUserMessageMatchText(message) !== null)) {",
     "    if (messages.some((message) => normalizedNativeChatUserMessageText(message) !== null)) {"),
]
mod["main"]()
