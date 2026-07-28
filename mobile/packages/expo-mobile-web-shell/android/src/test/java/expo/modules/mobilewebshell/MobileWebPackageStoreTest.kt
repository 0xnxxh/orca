package expo.modules.mobilewebshell

import org.json.JSONArray
import org.json.JSONObject
import org.junit.Assert.assertArrayEquals
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertThrows
import org.junit.Rule
import org.junit.Test
import org.junit.rules.TemporaryFolder
import java.io.File
import java.io.RandomAccessFile
import java.nio.file.StandardCopyOption
import java.security.MessageDigest
import java.util.Base64

class MobileWebPackageStoreTest {
  @get:Rule
  val temporary = TemporaryFolder()

  @Test
  fun stagesAndReadsOnlyTheExactVerifiedGeneration() {
    val root = temporary.newFolder()
    val store = MobileWebPackageStore(root)
    val fixture = packageFixture()

    stagePackage(store, "paired-host", fixture)
    val session = store.openSession("paired-host", fixture.buildId, 1)
    val asset = store.readAsset(session.getValue("sessionId"), "index.html")

    assertEquals(fixture.buildId, session["buildId"])
    assertEquals("text/html; charset=utf-8", asset.contentType)
    assertArrayEquals(fixture.bytes, asset.bytes)
    val error = assertThrows(IllegalArgumentException::class.java) {
      store.openSession("different-host", fixture.buildId, 1)
    }
    assertEquals("mobile_web_generation_invalid", error.message)
  }

  @Test
  fun rejectsMalformedManifestIdentityPathMimeAndTotalsBeforeCreatingAStage() {
    val root = temporary.newFolder()
    val store = MobileWebPackageStore(root)
    val valid = packageFixture()
    val invalid = listOf(
      valid.copy(canonical = "${valid.canonical} "),
      packageFixture(mutateAsset = { asset -> asset.put("path", "../index.html") }),
      packageFixture(mutateAsset = { asset -> asset.put("contentType", "application/octet-stream") }),
      packageFixture { _, manifest -> manifest.put("totalBytes", valid.bytes.size + 1) }
    )

    invalid.forEach { fixture ->
      val error = assertThrows(IllegalArgumentException::class.java) {
        store.beginStage("paired-host", fixture.manifest, fixture.canonical)
      }
      assertEquals("mobile_web_stage_manifest_invalid", error.message)
    }
    assertFalse(root.walkTopDown().any { it.name == "staging" && it.listFiles()?.isNotEmpty() == true })
  }

  @Test
  fun rejectsQuotedNumericManifestFieldsBeforeCreatingAStage() {
    val root = temporary.newFolder()
    val store = MobileWebPackageStore(root)
    val valid = packageFixture()
    val invalid = listOf(
      packageFixture { _, manifest -> manifest.put("schemaVersion", "1") },
      packageFixture { _, manifest ->
        manifest.getJSONObject("bridge").put("minimum", "1")
      },
      packageFixture { _, manifest ->
        manifest.getJSONObject("bridge").put("testedThrough", "1")
      },
      packageFixture { _, manifest -> manifest.put("totalBytes", valid.bytes.size.toString()) },
      packageFixture(mutateAsset = { asset ->
        asset.put("byteLength", valid.bytes.size.toString())
      })
    )

    invalid.forEach { fixture ->
      val error = assertThrows(IllegalArgumentException::class.java) {
        store.beginStage("paired-host", fixture.manifest, fixture.canonical)
      }
      assertEquals("mobile_web_stage_manifest_invalid", error.message)
    }
    assertFalse(
      root.walkTopDown().any { it.name == "staging" && it.listFiles()?.isNotEmpty() == true }
    )
  }

  @Test
  fun rejectsBooleanNumericManifestFieldsBeforeCreatingAStage() {
    val root = temporary.newFolder()
    val store = MobileWebPackageStore(root)
    val invalid = listOf(
      packageFixture { _, manifest -> manifest.put("schemaVersion", true) },
      packageFixture { _, manifest ->
        manifest.getJSONObject("bridge").put("minimum", true)
      },
      packageFixture { _, manifest ->
        manifest.getJSONObject("bridge").put("testedThrough", true)
      },
      packageFixture { _, manifest -> manifest.put("totalBytes", true) },
      packageFixture(mutateAsset = { asset -> asset.put("byteLength", true) })
    )

    invalid.forEach { fixture ->
      val error = assertThrows(IllegalArgumentException::class.java) {
        store.beginStage("paired-host", fixture.manifest, fixture.canonical)
      }
      assertEquals("mobile_web_stage_manifest_invalid", error.message)
    }
    assertFalse(
      root.walkTopDown().any { it.name == "staging" && it.listFiles()?.isNotEmpty() == true }
    )
  }

  @Test
  fun deletesAnInterruptedStageWhenTheStoreRestarts() {
    val root = temporary.newFolder()
    val firstStore = MobileWebPackageStore(root)
    val fixture = packageFixture()
    val stageId = firstStore.beginStage("paired-host", fixture.manifest, fixture.canonical)
    val stagingRoot = File(root, "${sha256Hex("paired-host".toByteArray())}/staging")

    assertEquals(1, stagingRoot.listFiles()?.size)
    MobileWebPackageStore(root)

    assertFalse(stagingRoot.listFiles()?.isNotEmpty() == true)
    assertThrows(IllegalArgumentException::class.java) {
      firstStore.writeAssetChunk(
        stageId,
        "index.html",
        0,
        Base64.getEncoder().encodeToString(fixture.bytes),
        sha256Hex(fixture.bytes)
      )
    }
  }

  @Test
  fun rejectsIncompleteStagesAndCorruptionOnOpenAndRead() {
    val root = temporary.newFolder()
    val store = MobileWebPackageStore(root)
    val fixture = packageFixture()
    val stageId = store.beginStage("paired-host", fixture.manifest, fixture.canonical)

    assertThrows(IllegalArgumentException::class.java) { store.commitStage(stageId) }
    store.abortStage(stageId)
    stagePackage(store, "paired-host", fixture)
    val session = store.openSession("paired-host", fixture.buildId, 1)
    val generation = File(
      root,
      "${sha256Hex("paired-host".toByteArray())}/generations/${fixture.buildId}/index.html"
    )
    generation.writeText("corrupt")

    val readError = assertThrows(IllegalArgumentException::class.java) {
      store.readAsset(session.getValue("sessionId"), "index.html")
    }
    assertEquals("mobile_web_generation_invalid", readError.message)
    val openError = assertThrows(IllegalArgumentException::class.java) {
      store.openSession("paired-host", fixture.buildId, 1)
    }
    assertEquals("mobile_web_generation_invalid", openError.message)
  }

  @Test
  fun activatesAndRecoversThePreviousVerifiedGeneration() {
    val root = temporary.newFolder()
    val store = testStore(root)
    val previous = packageFixture(content = "<!doctype html><title>Previous</title>")
    val current = packageFixture(content = "<!doctype html><title>Current</title>")
    stagePackage(store, "paired-host", previous)
    val previousSession = store.openSession("paired-host", previous.buildId, 1)
    assertEquals(previous.buildId, store.markSessionHealthy(previousSession.getValue("sessionId")))
    stagePackage(store, "paired-host", current)
    val currentSession = store.openSession("paired-host", current.buildId, 1)
    assertEquals(current.buildId, store.markSessionHealthy(currentSession.getValue("sessionId")))

    val recovered = store.recoverSession(currentSession.getValue("sessionId"))

    assertEquals(previous.buildId, recovered["buildId"])
    val active = store.openSession("paired-host", null, 1)
    assertEquals(previous.buildId, active["buildId"])
  }

  @Test
  fun fallsBackFromACorruptActiveGenerationOnColdOpen() {
    val root = temporary.newFolder()
    val store = testStore(root)
    val previous = packageFixture(content = "<!doctype html><title>Previous</title>")
    val current = packageFixture(content = "<!doctype html><title>Current</title>")
    stagePackage(store, "paired-host", previous)
    val previousSession = store.openSession("paired-host", previous.buildId, 1)
    store.markSessionHealthy(previousSession.getValue("sessionId"))
    store.closeSession(previousSession.getValue("sessionId"))
    stagePackage(store, "paired-host", current)
    val currentSession = store.openSession("paired-host", current.buildId, 1)
    store.markSessionHealthy(currentSession.getValue("sessionId"))
    store.closeSession(currentSession.getValue("sessionId"))
    val currentDocument = File(
      root,
      "${sha256Hex("paired-host".toByteArray())}/generations/${current.buildId}/index.html"
    )
    currentDocument.writeText("corrupt")

    val recovered = store.openSession("paired-host", null, 1)

    assertEquals(previous.buildId, recovered["buildId"])
    assertFalse(currentDocument.exists())
  }

  @Test
  fun rejectsNumericActivationFields() {
    val root = temporary.newFolder()
    val store = MobileWebPackageStore(root)
    val hostRoot = File(root, sha256Hex("paired-host".toByteArray()))
    require(hostRoot.mkdirs())
    val numericHash = "1".repeat(64)
    val validHash = "a".repeat(64)

    listOf(
      """{"active":$numericHash}""",
      """{"active":"$validHash","previous":$numericHash}"""
    ).forEach { activation ->
      File(hostRoot, "activation.json").writeText(activation)
      val error = assertThrows(IllegalArgumentException::class.java) {
        store.openSession("paired-host", null, 1)
      }
      assertEquals("mobile_web_activation_invalid", error.message)
    }
  }

  @Test
  fun rejectsLowStorageBeforeCreatingAStage() {
    val root = temporary.newFolder()
    val store = MobileWebPackageStore(
      root,
      availableStorageBytes = { MOBILE_WEB_MINIMUM_FREE_STORAGE_BYTES }
    )
    val fixture = packageFixture()

    val error = assertThrows(IllegalArgumentException::class.java) {
      store.beginStage("paired-host", fixture.manifest, fixture.canonical)
    }

    assertEquals("mobile_web_cache_storage_unavailable", error.message)
    assertFalse(root.walkTopDown().any { it.name == "staging" && it.listFiles()?.isNotEmpty() == true })
  }

  @Test
  fun evictsAnUnprotectedGenerationBeforeStaging() {
    val root = temporary.newFolder()
    val store = testStore(root)
    val active = packageFixture(content = "<!doctype html><title>Active</title>")
    stagePackage(store, "paired-host", active)
    val activeSession = store.openSession("paired-host", active.buildId, 1)
    store.markSessionHealthy(activeSession.getValue("sessionId"))
    val hostKey = sha256Hex("paired-host".toByteArray())
    val staleRoot = File(root, "$hostKey/generations/${"a".repeat(64)}")
    require(staleRoot.mkdirs())
    RandomAccessFile(File(staleRoot, "stale.bin"), "rw").use {
      it.setLength(MOBILE_WEB_PER_HOST_CACHE_BYTE_LIMIT)
    }
    val fixture = packageFixture(content = "<!doctype html><title>Next</title>")

    val stageId = store.beginStage("paired-host", fixture.manifest, fixture.canonical)

    assertFalse(staleRoot.exists())
    assertArrayEquals(
      active.bytes,
      store.readAsset(activeSession.getValue("sessionId"), "index.html").bytes
    )
    store.abortStage(stageId)
  }

  @Test
  fun evictsAnotherHostsUnprotectedGenerationForTheGlobalQuota() {
    val root = temporary.newFolder()
    val otherHostKey = sha256Hex("other-host".toByteArray())
    val staleRoot = File(root, "$otherHostKey/generations/${"b".repeat(64)}")
    require(staleRoot.mkdirs())
    RandomAccessFile(File(staleRoot, "stale.bin"), "rw").use {
      it.setLength(MOBILE_WEB_GLOBAL_CACHE_BYTE_LIMIT)
    }
    val store = MobileWebPackageStore(root)
    val fixture = packageFixture()

    val stageId = store.beginStage("paired-host", fixture.manifest, fixture.canonical)

    assertFalse(staleRoot.exists())
    store.abortStage(stageId)
  }

  @Test
  fun removesOnlyTheSelectedHostCacheSessionsAndStages() {
    val root = temporary.newFolder()
    val store = MobileWebPackageStore(root)
    val removed = packageFixture(content = "<!doctype html><title>Removed</title>")
    val retained = packageFixture(content = "<!doctype html><title>Retained</title>")
    stagePackage(store, "removed-host", removed)
    stagePackage(store, "retained-host", retained)
    val removedSession = store.openSession("removed-host", removed.buildId, 1)
    val retainedSession = store.openSession("retained-host", retained.buildId, 1)
    val interruptedStage = store.beginStage("removed-host", removed.manifest, removed.canonical)

    store.removeHost("removed-host")

    assertFalse(File(root, sha256Hex("removed-host".toByteArray())).exists())
    assertThrows(IllegalArgumentException::class.java) {
      store.readAsset(removedSession.getValue("sessionId"), "index.html")
    }
    assertThrows(IllegalArgumentException::class.java) {
      store.writeAssetChunk(interruptedStage, "index.html", 0, "YQ==", sha256Hex("a".toByteArray()))
    }
    assertArrayEquals(
      retained.bytes,
      store.readAsset(retainedSession.getValue("sessionId"), "index.html").bytes
    )
  }

  private fun stagePackage(
    store: MobileWebPackageStore,
    hostIdentity: String,
    fixture: PackageFixture
  ) {
    val stageId = store.beginStage(hostIdentity, fixture.manifest, fixture.canonical)
    store.writeAssetChunk(
      stageId,
      "index.html",
      0,
      Base64.getEncoder().encodeToString(fixture.bytes),
      sha256Hex(fixture.bytes)
    )
    store.finishAsset(stageId, "index.html")
    assertEquals(fixture.buildId, store.commitStage(stageId))
  }

  private fun packageFixture(
    content: String = "<!doctype html><title>Orca</title>",
    mutateAsset: (JSONObject) -> Unit = {},
    mutateManifest: (JSONObject, JSONObject) -> Unit = { _, _ -> }
  ): PackageFixture {
    val bytes = content.toByteArray()
    val asset = JSONObject()
      .put("path", "index.html")
      .put("sha256", sha256Hex(bytes))
      .put("byteLength", bytes.size)
      .put("contentType", "text/html; charset=utf-8")
      .put("role", "document")
    mutateAsset(asset)
    val canonical = JSONObject()
      .put("schemaVersion", 1)
      .put("bridge", JSONObject().put("minimum", 1).put("testedThrough", 1))
      .put("entrypoint", "index.html")
      .put("totalBytes", bytes.size)
      .put("assets", JSONArray().put(asset))
    mutateManifest(asset, canonical)
    val canonicalJson = canonical.toString()
    val buildId = sha256Hex(canonicalJson.toByteArray())
    val manifest = JSONObject(canonicalJson).put("buildId", buildId).toString()
    return PackageFixture(bytes, canonicalJson, manifest, buildId)
  }

  private fun testStore(root: File): MobileWebPackageStore =
    MobileWebPackageStore(
      root,
      replaceActivation = { source, destination ->
        java.nio.file.Files.move(
          source.toPath(),
          destination.toPath(),
          StandardCopyOption.ATOMIC_MOVE,
          StandardCopyOption.REPLACE_EXISTING
        )
      }
    )
}

private data class PackageFixture(
  val bytes: ByteArray,
  val canonical: String,
  val manifest: String,
  val buildId: String
)

private fun sha256Hex(bytes: ByteArray): String =
  MessageDigest.getInstance("SHA-256").digest(bytes).joinToString("") { "%02x".format(it) }
