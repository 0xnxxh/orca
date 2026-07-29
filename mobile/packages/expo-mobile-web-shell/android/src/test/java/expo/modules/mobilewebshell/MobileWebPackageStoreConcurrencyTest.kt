package expo.modules.mobilewebshell

import org.json.JSONArray
import org.json.JSONObject
import org.junit.Assert.assertArrayEquals
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Rule
import org.junit.Test
import org.junit.rules.TemporaryFolder
import java.io.File
import java.nio.file.Files
import java.nio.file.StandardCopyOption
import java.security.MessageDigest
import java.util.Base64
import java.util.concurrent.ConcurrentLinkedQueue
import java.util.concurrent.CountDownLatch
import java.util.concurrent.Executors
import java.util.concurrent.TimeUnit

class MobileWebPackageStoreConcurrencyTest {
  @get:Rule
  val temporary = TemporaryFolder()

  @Test
  fun serializesConcurrentHostsAndDuplicateGenerationCommits() {
    val root = temporary.newFolder()
    val store = concurrencyStore(root)
    val failures = ConcurrentLinkedQueue<Throwable>()

    runConcurrent(24, failures) { index ->
      val host = "concurrent-host-$index"
      val fixture = concurrencyFixture("<title>$index</title>")
      concurrencyStagePackage(store, host, fixture)
      val session = store.openSession(host, fixture.buildId, 1)
      val sessionId = session.getValue("sessionId")
      assertArrayEquals(fixture.bytes, store.readAsset(sessionId, "index.html").bytes)
      assertEquals(fixture.buildId, store.markSessionHealthy(sessionId))
      store.closeSession(sessionId)
    }
    assertTrue(failures.joinToString("\n") { it.stackTraceToString() }, failures.isEmpty())

    val duplicate = concurrencyFixture("<title>same generation</title>")
    runConcurrent(24, failures) {
      concurrencyStagePackage(store, "same-host", duplicate)
    }
    assertTrue(failures.joinToString("\n") { it.stackTraceToString() }, failures.isEmpty())
    runConcurrent(24, failures) {
      val session = store.openSession("same-host", duplicate.buildId, 1)
      val sessionId = session.getValue("sessionId")
      assertArrayEquals(duplicate.bytes, store.readAsset(sessionId, "index.html").bytes)
      assertEquals(duplicate.buildId, store.markSessionHealthy(sessionId))
      store.closeSession(sessionId)
    }
    assertTrue(failures.joinToString("\n") { it.stackTraceToString() }, failures.isEmpty())
    val session = store.openSession("same-host", null, 1)
    assertArrayEquals(
      duplicate.bytes,
      store.readAsset(session.getValue("sessionId"), "index.html").bytes
    )
    val staging = File(root, "${concurrencySha256("same-host".toByteArray())}/staging")
    assertFalse(staging.listFiles()?.isNotEmpty() == true)
  }

  private fun runConcurrent(
    count: Int,
    failures: ConcurrentLinkedQueue<Throwable>,
    operation: (Int) -> Unit
  ) {
    val executor = Executors.newFixedThreadPool(count)
    val ready = CountDownLatch(count)
    val start = CountDownLatch(1)
    val complete = CountDownLatch(count)
    repeat(count) { index ->
      executor.execute {
        ready.countDown()
        try {
          start.await()
          operation(index)
        } catch (error: Throwable) {
          failures += error
        } finally {
          complete.countDown()
        }
      }
    }
    assertTrue(ready.await(10, TimeUnit.SECONDS))
    start.countDown()
    assertTrue(complete.await(30, TimeUnit.SECONDS))
    executor.shutdownNow()
  }

  private fun concurrencyStagePackage(
    store: MobileWebPackageStore,
    host: String,
    fixture: ConcurrencyFixture
  ) {
    val stageId = store.beginStage(host, fixture.manifest, fixture.canonical)
    store.writeAssetChunk(
      stageId,
      "index.html",
      0,
      Base64.getEncoder().encodeToString(fixture.bytes),
      concurrencySha256(fixture.bytes)
    )
    store.finishAsset(stageId, "index.html")
    assertEquals(fixture.buildId, store.commitStage(stageId))
  }

  private fun concurrencyFixture(content: String): ConcurrencyFixture {
    val bytes = content.toByteArray()
    val asset = JSONObject()
      .put("path", "index.html")
      .put("sha256", concurrencySha256(bytes))
      .put("byteLength", bytes.size)
      .put("contentType", "text/html; charset=utf-8")
      .put("role", "document")
    val canonical = JSONObject()
      .put("schemaVersion", 1)
      .put("bridge", JSONObject().put("minimum", 1).put("testedThrough", 1))
      .put("entrypoint", "index.html")
      .put("totalBytes", bytes.size)
      .put("assets", JSONArray().put(asset))
      .toString()
    val buildId = concurrencySha256(canonical.toByteArray())
    val manifest = JSONObject(canonical).put("buildId", buildId).toString()
    return ConcurrencyFixture(bytes, canonical, manifest, buildId)
  }

  private fun concurrencyStore(root: File): MobileWebPackageStore =
    jvmMobileWebPackageStore(
      root,
      replaceActivation = { source, destination ->
        Files.move(
          source.toPath(),
          destination.toPath(),
          StandardCopyOption.ATOMIC_MOVE,
          StandardCopyOption.REPLACE_EXISTING
        )
      }
    )

  private fun concurrencySha256(bytes: ByteArray): String =
    MessageDigest.getInstance("SHA-256").digest(bytes).joinToString("") { "%02x".format(it) }

  private data class ConcurrencyFixture(
    val bytes: ByteArray,
    val canonical: String,
    val manifest: String,
    val buildId: String
  )
}
