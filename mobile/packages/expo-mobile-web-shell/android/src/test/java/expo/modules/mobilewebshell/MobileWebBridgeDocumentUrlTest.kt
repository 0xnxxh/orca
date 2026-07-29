package expo.modules.mobilewebshell

import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

class MobileWebBridgeDocumentUrlTest {
  private val sessionId = "S".repeat(43)

  @Test
  fun `accepts session-bound client routes`() {
    assertTrue(
      isAllowedMobileWebBridgeDocumentUrl(
        "https://orca-mobile-web.invalid/#$sessionId",
        sessionId
      )
    )
    assertTrue(
      isAllowedMobileWebBridgeDocumentUrl(
        "https://orca-mobile-web.invalid/h/paired-orca-desktop/tasks#$sessionId",
        sessionId
      )
    )
    assertTrue(
      isAllowedMobileWebBridgeDocumentUrl(
        "https://orca-mobile-web.invalid/h/paired-orca-desktop/session/workspace" +
          "?name=Feature+One#$sessionId",
        sessionId
      )
    )
  }

  @Test
  fun `rejects documents outside the active origin and session`() {
    val rejected = listOf(
      "http://orca-mobile-web.invalid/#$sessionId",
      "https://user@orca-mobile-web.invalid/#$sessionId",
      "https://orca-mobile-web.invalid:443/#$sessionId",
      "https://orca-mobile-web.invalid.evil.test/#$sessionId",
      "https://orca-mobile-web.invalid/",
      "https://orca-mobile-web.invalid/#${"T".repeat(43)}",
      "https://orca-mobile-web.invalid/${"a".repeat(8 * 1024)}#$sessionId",
      "not a url"
    )

    for (value in rejected) {
      assertFalse(value, isAllowedMobileWebBridgeDocumentUrl(value, sessionId))
    }
  }
}
