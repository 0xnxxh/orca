package expo.modules.mobilewebshell

import expo.modules.kotlin.functions.Queues
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition

class ExpoMobileWebShellModule : Module() {
  private val sessionViews = mutableMapOf<String, MobileWebShellView>()

  private val packageStore by lazy {
    val context = requireNotNull(appContext.reactContext) { "mobile_web_context_unavailable" }
    MobileWebShellEnvironment.packageStore(context)
  }

  override fun definition() = ModuleDefinition {
    Name("ExpoMobileWebShell")

    AsyncFunction("beginStage") {
        hostIdentity: String,
        manifestJson: String,
        canonicalManifestJson: String ->
      packageStore.beginStage(hostIdentity, manifestJson, canonicalManifestJson)
    }

    AsyncFunction("writeAssetChunk") {
        stageId: String,
        path: String,
        offset: Int,
        dataBase64: String,
        chunkSha256: String ->
      packageStore.writeAssetChunk(stageId, path, offset, dataBase64, chunkSha256)
    }

    AsyncFunction("finishAsset") { stageId: String, path: String ->
      packageStore.finishAsset(stageId, path)
    }

    AsyncFunction("commitStage") { stageId: String ->
      mapOf("buildId" to packageStore.commitStage(stageId))
    }

    AsyncFunction("abortStage") { stageId: String ->
      packageStore.abortStage(stageId)
    }

    AsyncFunction("openSession") {
        hostIdentity: String,
        buildId: String?,
        bridgeVersion: Int ->
      packageStore.openSession(hostIdentity, buildId, bridgeVersion)
    }

    AsyncFunction("recoverSession") { sessionId: String ->
      packageStore.recoverSession(sessionId)
    }

    AsyncFunction("markSessionHealthy") { sessionId: String ->
      mapOf("buildId" to packageStore.markSessionHealthy(sessionId))
    }

    AsyncFunction("closeSession") { sessionId: String ->
      packageStore.closeSession(sessionId)
    }

    AsyncFunction("removeHost") { hostIdentity: String ->
      packageStore.removeHost(hostIdentity)
    }

    AsyncFunction("activateViewSession") { sessionId: String ->
      requireSessionView(sessionId).activateSessionView(sessionId)
    }.runOnQueue(Queues.MAIN)

    AsyncFunction("deactivateViewSession") { sessionId: String ->
      requireSessionView(sessionId).deactivateSessionView()
    }.runOnQueue(Queues.MAIN)

    AsyncFunction("postViewMessage") { sessionId: String, message: String ->
      sessionViews[sessionId]?.postMessageIfActive(sessionId, message)
    }.runOnQueue(Queues.MAIN)

    View(MobileWebShellView::class) {
      Events("onBridgeMessage", "onNavigationBlocked", "onProcessTerminated", "onLoadState")

      Prop("sessionId") { view, sessionId: String? ->
        view.setSessionId(sessionId)
        if (sessionId != null) {
          sessionViews.entries.removeAll { it.value === view && it.key != sessionId }
          sessionViews[sessionId] = view
        }
      }

      OnViewDestroys { view ->
        sessionViews.entries.removeAll { it.value === view }
      }

      AsyncFunction("activateSessionView") { view: MobileWebShellView, sessionId: String ->
        view.activateSessionView(sessionId)
      }

      AsyncFunction("deactivateSessionView") { view: MobileWebShellView ->
        view.deactivateSessionView()
      }

      AsyncFunction("postMessage") { view: MobileWebShellView, message: String ->
        view.postMessage(message)
      }
    }
  }

  private fun requireSessionView(sessionId: String): MobileWebShellView =
    requireNotNull(sessionViews[sessionId]) { "mobile_web_shell_view_unavailable" }
}
