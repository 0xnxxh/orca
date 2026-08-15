// Single-sources the marker logic (pure functions over shared types):
// Claude records adjacent `[Image: source: /path]` and `[Image #N]` caption
// turns in either order; render and echo reconciliation must agree with desktop.
export {
  countImagePromptMarkers,
  imageSourcePathFromText,
  hasImagePromptMarker,
  isImageSourceUserTurn,
  nativeChatUserMessageImageEvidenceCount,
  nativeChatUserMessageMatchText,
  nativeChatUserTextMatchText,
  normalizeImageTranscriptMessages,
  normalizeNativeChatUserText,
  normalizedNativeChatUserMessageText,
  stripImagePromptMarker
} from '../../../src/shared/native-chat-image-transcript-markers'
