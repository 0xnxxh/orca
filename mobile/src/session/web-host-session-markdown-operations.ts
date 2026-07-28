import type { MobileWebBridgeClient } from '../../../src/mobile-web/src/mobile-web-bridge-client'
import type { HostSessionMarkdownOperations } from './host-session-markdown-operations'

export function webHostSessionMarkdownOperations(
  client: MobileWebBridgeClient
): HostSessionMarkdownOperations {
  return {
    async readTab(request) {
      const result = await client.markdown.read(request)
      return {
        status: 'ready',
        content: result.content,
        localContent: result.content,
        baseVersion: result.baseVersion,
        isDirty: false,
        editable: result.editable,
        stale: result.stale,
        readOnlyReason: result.readOnlyReason
      }
    },
    async saveTab(request) {
      const result = await client.markdown.save(request)
      return { content: result.content, baseVersion: result.baseVersion }
    },
    loadDraft(target) {
      return client.markdown.loadDraft(target)
    },
    async saveDraft(target, draft) {
      await client.markdown.saveDraft({ ...target, draft })
    }
  }
}
