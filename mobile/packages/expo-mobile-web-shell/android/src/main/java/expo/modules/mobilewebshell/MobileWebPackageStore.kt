package expo.modules.mobilewebshell

import android.content.Context
import android.system.Os
import org.json.JSONArray
import org.json.JSONObject
import java.io.File
import java.io.FileOutputStream
import java.io.IOException
import java.security.MessageDigest
import java.security.SecureRandom
import java.util.Base64

private const val CHUNK_BYTE_LIMIT = 48 * 1024
private const val ASSET_BYTE_LIMIT = 10 * 1024 * 1024
private val SHA256_PATTERN = Regex("^[a-f0-9]{64}$")
private val SAFE_PATH_PATTERN = Regex("^[A-Za-z0-9._/-]+$")

private data class MobileWebAssetRecord(
  val path: String,
  val sha256: String,
  val byteLength: Int,
  val contentType: String,
  val role: String
)

private data class MobileWebManifestRecord(
  val buildId: String,
  val bridgeMinimum: Int,
  val bridgeTestedThrough: Int,
  val entrypoint: String,
  val assets: Map<String, MobileWebAssetRecord>
)

internal data class MobileWebAssetResponse(
  val bytes: ByteArray,
  val contentType: String,
  val isDocument: Boolean
)

private data class MobileWebStageRecord(
  val hostKey: String,
  val root: File,
  val manifest: MobileWebManifestRecord,
  val reservedByteLength: Long,
  val finishedPaths: MutableSet<String> = mutableSetOf()
)

private data class MobileWebSessionRecord(
  val hostKey: String,
  val buildId: String,
  val bridgeVersion: Int,
  val root: File,
  val manifest: MobileWebManifestRecord
)

internal class MobileWebPackageStore internal constructor(
  private val cacheRoot: File,
  private val availableStorageBytes: (File) -> Long = { it.usableSpace },
  private val replaceActivation: (source: File, destination: File) -> Unit = ::replaceActivationFile
) {
  internal constructor(context: Context) : this(File(context.noBackupFilesDir, "OrcaMobileWeb"))

  private val stages = mutableMapOf<String, MobileWebStageRecord>()
  private val sessions = mutableMapOf<String, MobileWebSessionRecord>()

  init {
    runCatching {
      require(cacheRoot.mkdirs() || cacheRoot.isDirectory) { "mobile_web_cache_create_failed" }
      cleanupOrphanedWrites()
    }
  }

  @Synchronized
  fun beginStage(
    hostIdentity: String,
    manifestJson: String,
    canonicalManifestJson: String
  ): String {
    require(hostIdentity.isNotEmpty() && hostIdentity.toByteArray().size <= 8 * 1024) {
      "mobile_web_host_identity_invalid"
    }
    val manifest = parseManifest(manifestJson, canonicalManifestJson)
    val hostKey = sha256Hex(hostIdentity.toByteArray(Charsets.UTF_8))
    val stageId = randomIdentifier()
    require(cacheRoot.mkdirs() || cacheRoot.isDirectory) { "mobile_web_cache_create_failed" }
    cleanupOrphanedWrites()
    val reservedByteLength = manifest.assets.values.sumOf { it.byteLength }.toLong() +
      manifestJson.toByteArray(Charsets.UTF_8).size +
      canonicalManifestJson.toByteArray(Charsets.UTF_8).size
    reserveCacheCapacity(hostKey, reservedByteLength)
    val stageRoot = File(cacheRoot, "$hostKey/staging/$stageId")
    try {
      require(stageRoot.mkdirs()) { "mobile_web_stage_create_failed" }
      File(stageRoot, "manifest.json").writeText(manifestJson, Charsets.UTF_8)
      File(stageRoot, "canonical-manifest.json").writeText(canonicalManifestJson, Charsets.UTF_8)
      for (asset in manifest.assets.values) {
        val file = assetFile(stageRoot, asset.path)
        requireMobileWebAssetParent(file)
        require(file.createNewFile()) { "mobile_web_stage_create_failed" }
      }
    } catch (error: Exception) {
      stageRoot.deleteRecursively()
      throw storageException(error, "mobile_web_stage_create_failed")
    }
    stages[stageId] = MobileWebStageRecord(hostKey, stageRoot, manifest, reservedByteLength)
    return stageId
  }

  @Synchronized
  fun writeAssetChunk(
    stageId: String,
    path: String,
    offset: Int,
    dataBase64: String,
    chunkSha256: String
  ) {
    val stage = requireStage(stageId)
    val asset = stage.manifest.assets[path]
      ?: throw IllegalArgumentException("mobile_web_stage_asset_unknown")
    require(path !in stage.finishedPaths) { "mobile_web_stage_asset_unknown" }
    val bytes = try {
      Base64.getDecoder().decode(dataBase64)
    } catch (_: IllegalArgumentException) {
      throw IllegalArgumentException("mobile_web_stage_chunk_invalid")
    }
    require(
      bytes.isNotEmpty() &&
        bytes.size <= CHUNK_BYTE_LIMIT &&
        Base64.getEncoder().encodeToString(bytes) == dataBase64 &&
        SHA256_PATTERN.matches(chunkSha256) &&
        sha256Hex(bytes) == chunkSha256
    ) { "mobile_web_stage_chunk_invalid" }
    val file = assetFile(stage.root, path)
    require(offset >= 0 && file.length() == offset.toLong()) {
      "mobile_web_stage_offset_invalid"
    }
    require(offset + bytes.size <= asset.byteLength) { "mobile_web_stage_offset_invalid" }
    try {
      FileOutputStream(file, true).use { it.write(bytes) }
    } catch (error: Exception) {
      throw storageException(error, "mobile_web_stage_write_failed")
    }
  }

  @Synchronized
  fun finishAsset(stageId: String, path: String) {
    val stage = requireStage(stageId)
    val asset = stage.manifest.assets[path]
      ?: throw IllegalArgumentException("mobile_web_stage_asset_unknown")
    require(path !in stage.finishedPaths) { "mobile_web_stage_asset_unknown" }
    val file = assetFile(stage.root, path)
    require(file.length() == asset.byteLength.toLong() && sha256Hex(file.readBytes()) == asset.sha256) {
      "mobile_web_stage_asset_invalid"
    }
    FileOutputStream(file, true).use { it.fd.sync() }
    stage.finishedPaths += path
  }

  @Synchronized
  fun commitStage(stageId: String): String {
    val stage = requireStage(stageId)
    require(stage.finishedPaths.size == stage.manifest.assets.size) { "mobile_web_stage_incomplete" }
    val generations = File(cacheRoot, "${stage.hostKey}/generations")
    require(generations.mkdirs() || generations.isDirectory) { "mobile_web_generation_create_failed" }
    val destination = File(generations, stage.manifest.buildId)
    try {
      if (destination.exists()) {
        verifyCommittedGeneration(destination, stage.manifest)
        require(stage.root.deleteRecursively()) { "mobile_web_stage_cleanup_failed" }
      } else {
        require(stage.root.renameTo(destination)) { "mobile_web_generation_commit_failed" }
      }
    } catch (error: Exception) {
      throw storageException(error, "mobile_web_generation_commit_failed")
    }
    stages.remove(stageId)
    return stage.manifest.buildId
  }

  @Synchronized
  fun abortStage(stageId: String) {
    stages.remove(stageId)?.root?.deleteRecursively()
  }

  @Synchronized
  fun openSession(hostIdentity: String, buildId: String?, bridgeVersion: Int): Map<String, String> {
    val hostKey = validatedHostKey(hostIdentity)
    val hostRoot = File(cacheRoot, hostKey)
    if (buildId != null) {
      require(SHA256_PATTERN.matches(buildId)) { "mobile_web_generation_invalid" }
      return openVerifiedSession(hostKey, hostRoot, buildId, bridgeVersion)
    }
    val activation = readActivation(hostRoot)
    return try {
      openVerifiedSession(hostKey, hostRoot, activation.first, bridgeVersion)
    } catch (error: Exception) {
      val previous = activation.second?.takeIf { it != activation.first } ?: throw error
      openVerifiedSession(hostKey, hostRoot, previous, bridgeVersion, activateFallback = true)
    }
  }

  private fun openVerifiedSession(
    hostKey: String,
    hostRoot: File,
    selectedBuildId: String,
    bridgeVersion: Int,
    activateFallback: Boolean = false
  ): Map<String, String> {
    val generationRoot = File(hostRoot, "generations/$selectedBuildId")
    val manifest = verifyGeneration(generationRoot)
    require(manifest.buildId == selectedBuildId) { "mobile_web_generation_invalid" }
    requireCompatibleBridge(manifest, bridgeVersion)
    if (activateFallback) {
      writeActivation(hostRoot, selectedBuildId, null)
    }
    generationRoot.setLastModified(System.currentTimeMillis())
    val sessionId = randomIdentifier()
    sessions[sessionId] = MobileWebSessionRecord(
      hostKey,
      selectedBuildId,
      bridgeVersion,
      generationRoot,
      manifest
    )
    if (activateFallback) {
      runCatching { removeUnusedGenerations(hostRoot, selectedBuildId, null) }
    }
    return sessionResponse(sessionId, selectedBuildId)
  }

  @Synchronized
  fun recoverSession(sessionId: String): Map<String, String> {
    val failed = sessions[sessionId]
      ?: throw IllegalArgumentException("mobile_web_session_unknown")
    val hostRoot = File(cacheRoot, failed.hostKey)
    val activation = readActivation(hostRoot)
    val fallbackBuildId: String
    val fallbackPrevious: String?
    if (activation.first == failed.buildId) {
      fallbackBuildId = activation.second
        ?.takeIf { it != failed.buildId }
        ?: throw IllegalArgumentException("mobile_web_recovery_unavailable")
      fallbackPrevious = null
    } else {
      fallbackBuildId = activation.first
      fallbackPrevious = activation.second
    }
    val generationRoot = File(hostRoot, "generations/$fallbackBuildId")
    val manifest = verifyGeneration(generationRoot)
    require(manifest.buildId == fallbackBuildId && fallbackBuildId != failed.buildId) {
      "mobile_web_recovery_unavailable"
    }
    requireCompatibleBridge(manifest, failed.bridgeVersion)
    if (activation.first == failed.buildId) {
      writeActivation(hostRoot, fallbackBuildId, null)
    }
    sessions.remove(sessionId)
    val recoveredSessionId = randomIdentifier()
    sessions[recoveredSessionId] = MobileWebSessionRecord(
      failed.hostKey,
      fallbackBuildId,
      failed.bridgeVersion,
      generationRoot,
      manifest
    )
    runCatching { removeUnusedGenerations(hostRoot, fallbackBuildId, fallbackPrevious) }
    return sessionResponse(recoveredSessionId, fallbackBuildId)
  }

  @Synchronized
  fun markSessionHealthy(sessionId: String): String {
    val session = sessions[sessionId]
      ?: throw IllegalArgumentException("mobile_web_session_unknown")
    val hostRoot = File(cacheRoot, session.hostKey)
    val current = runCatching { readActivation(hostRoot) }.getOrNull()
    val previous = if (current?.first == session.buildId) current.second else current?.first
    writeActivation(hostRoot, session.buildId, previous)
    removeUnusedGenerations(hostRoot, session.buildId, previous)
    return session.buildId
  }

  @Synchronized
  fun closeSession(sessionId: String) {
    sessions.remove(sessionId)
  }

  @Synchronized
  fun readAsset(sessionId: String, path: String): MobileWebAssetResponse {
    val session = sessions[sessionId]
      ?: throw IllegalArgumentException("mobile_web_asset_unavailable")
    val asset = session.manifest.assets[path]
      ?: throw IllegalArgumentException("mobile_web_asset_unavailable")
    val file = assetFile(session.root, asset.path)
    val bytes = try {
      file.readBytes()
    } catch (_: Exception) {
      throw IllegalArgumentException("mobile_web_generation_invalid")
    }
    require(bytes.size == asset.byteLength && sha256Hex(bytes) == asset.sha256) {
      "mobile_web_generation_invalid"
    }
    return MobileWebAssetResponse(bytes, asset.contentType, asset.role == "document")
  }

  @Synchronized
  fun removeHost(hostIdentity: String) {
    require(hostIdentity.isNotEmpty() && hostIdentity.toByteArray().size <= 8 * 1024) {
      "mobile_web_host_identity_invalid"
    }
    val hostKey = validatedHostKey(hostIdentity)
    stages.entries.removeAll { it.value.hostKey == hostKey }
    sessions.entries.removeAll { it.value.hostKey == hostKey }
    val hostRoot = File(cacheRoot, hostKey)
    require(!hostRoot.exists() || hostRoot.deleteRecursively()) { "mobile_web_host_cleanup_failed" }
  }

  private fun parseManifest(
    manifestJson: String,
    canonicalManifestJson: String
  ): MobileWebManifestRecord {
    val manifest = parseJsonObject(manifestJson)
    val canonical = parseJsonObject(canonicalManifestJson)
    require(
      manifest.keys().asSequence().toSet() ==
        setOf("schemaVersion", "buildId", "bridge", "entrypoint", "totalBytes", "assets") &&
        strictJsonInt(manifest, "schemaVersion") == 1
    ) { "mobile_web_stage_manifest_invalid" }
    val bridge = manifest.optJSONObject("bridge")
      ?: throw IllegalArgumentException("mobile_web_stage_manifest_invalid")
    val bridgeMinimum = strictJsonInt(bridge, "minimum") ?: -1
    val bridgeTestedThrough = strictJsonInt(bridge, "testedThrough") ?: -1
    val entrypoint = strictJsonString(manifest, "entrypoint") ?: ""
    val declaredTotalBytes = strictJsonInt(manifest, "totalBytes") ?: -1
    require(
      bridge.keys().asSequence().toSet() == setOf("minimum", "testedThrough") &&
        bridgeMinimum > 0 &&
        bridgeMinimum <= bridgeTestedThrough &&
        bridgeTestedThrough <= 65_535 &&
        isSafeAssetPath(entrypoint) &&
        declaredTotalBytes in 1..(32 * 1024 * 1024)
    ) { "mobile_web_stage_manifest_invalid" }
    val buildId = strictJsonString(manifest, "buildId") ?: ""
    require(
      SHA256_PATTERN.matches(buildId) &&
        sha256Hex(canonicalManifestJson.toByteArray(Charsets.UTF_8)) == buildId
    ) { "mobile_web_stage_manifest_invalid" }
    val expected = JSONObject(manifestJson).apply { remove("buildId") }
    require(jsonEquivalent(expected, canonical)) { "mobile_web_stage_manifest_invalid" }
    val assetValues = manifest.optJSONArray("assets")
      ?: throw IllegalArgumentException("mobile_web_stage_manifest_invalid")
    require(assetValues.length() in 1..256) { "mobile_web_stage_manifest_invalid" }
    val assets = mutableMapOf<String, MobileWebAssetRecord>()
    var totalBytes = 0
    var documentCount = 0
    var previousPath: String? = null
    for (index in 0 until assetValues.length()) {
      val value = assetValues.optJSONObject(index)
        ?: throw IllegalArgumentException("mobile_web_stage_manifest_invalid")
      require(
        value.keys().asSequence().toSet() ==
          setOf("path", "sha256", "byteLength", "contentType", "role")
      ) { "mobile_web_stage_manifest_invalid" }
      val path = strictJsonString(value, "path") ?: ""
      val hash = strictJsonString(value, "sha256") ?: ""
      val length = strictJsonInt(value, "byteLength") ?: -1
      val contentType = strictJsonString(value, "contentType") ?: ""
      val role = strictJsonString(value, "role") ?: ""
      require(
        isSafeAssetPath(path) &&
          SHA256_PATTERN.matches(hash) &&
          length in 1..ASSET_BYTE_LIMIT &&
          path !in assets &&
          (previousPath?.let { it < path } ?: true) &&
          isValidAssetMetadata(path, hash, contentType, role)
      ) { "mobile_web_stage_manifest_invalid" }
      assets[path] = MobileWebAssetRecord(path, hash, length, contentType, role)
      totalBytes += length
      documentCount += if (role == "document") 1 else 0
      previousPath = path
    }
    require(
      totalBytes == declaredTotalBytes &&
        documentCount == 1 &&
        assets[entrypoint]?.role == "document"
    ) { "mobile_web_stage_manifest_invalid" }
    return MobileWebManifestRecord(
      buildId,
      bridgeMinimum,
      bridgeTestedThrough,
      entrypoint,
      assets
    )
  }

  private fun requireCompatibleBridge(manifest: MobileWebManifestRecord, bridgeVersion: Int) {
    require(bridgeVersion in manifest.bridgeMinimum..manifest.bridgeTestedThrough) {
      "mobile_web_bridge_incompatible"
    }
  }

  private fun verifyCommittedGeneration(root: File, manifest: MobileWebManifestRecord) {
    for (asset in manifest.assets.values) {
      val file = assetFile(root, asset.path)
      require(file.length() == asset.byteLength.toLong() && sha256Hex(file.readBytes()) == asset.sha256) {
        "mobile_web_generation_invalid"
      }
    }
  }

  private fun verifyGeneration(root: File): MobileWebManifestRecord = try {
    val manifest = parseManifest(
      File(root, "manifest.json").readText(Charsets.UTF_8),
      File(root, "canonical-manifest.json").readText(Charsets.UTF_8)
    )
    verifyCommittedGeneration(root, manifest)
    manifest
  } catch (_: Exception) {
    throw IllegalArgumentException("mobile_web_generation_invalid")
  }

  private fun readActivation(hostRoot: File): Pair<String, String?> {
    val value = parseJsonObject(File(hostRoot, "activation.json").readText(Charsets.UTF_8))
    require(value.keys().asSequence().toSet().let { it == setOf("active") || it == setOf("active", "previous") }) {
      "mobile_web_activation_invalid"
    }
    val active = value.optString("active")
    val previous = if (value.has("previous") && !value.isNull("previous")) {
      value.optString("previous")
    } else {
      null
    }
    require(SHA256_PATTERN.matches(active) && (previous == null || SHA256_PATTERN.matches(previous))) {
      "mobile_web_activation_invalid"
    }
    return active to previous
  }

  private fun writeActivation(hostRoot: File, active: String, previous: String?) {
    require(hostRoot.mkdirs() || hostRoot.isDirectory) { "mobile_web_activation_write_failed" }
    val value = JSONObject().put("active", active)
    if (previous != null) value.put("previous", previous)
    val destination = File(hostRoot, "activation.json")
    val temporary = File(hostRoot, "activation-${randomIdentifier()}.tmp")
    FileOutputStream(temporary).use {
      it.write(value.toString().toByteArray(Charsets.UTF_8))
      it.fd.sync()
    }
    try {
      replaceActivation(temporary, destination)
    } finally {
      temporary.delete()
    }
  }

  private fun removeUnusedGenerations(hostRoot: File, active: String, previous: String?) {
    val sessionBuilds = sessions.values.filter { it.hostKey == hostRoot.name }.map { it.buildId }
    val retained = (sessionBuilds + listOfNotNull(active, previous)).toSet()
    File(hostRoot, "generations").listFiles()?.forEach { child ->
      if (child.name !in retained) {
        require(child.deleteRecursively()) { "mobile_web_generation_cleanup_failed" }
      }
    }
  }

  private fun reserveCacheCapacity(hostKey: String, requestedBytes: Long) {
    val stageReservations = stages.values.map { stage ->
      stage to (stage.reservedByteLength - logicalByteLength(stage.root)).coerceAtLeast(0)
    }
    val hostStageReservations = stageReservations
      .filter { it.first.hostKey == hostKey }
      .sumOf { it.second }
    val allStageReservations = stageReservations.sumOf { it.second }
    val projectedHostBytes = logicalByteLength(File(cacheRoot, hostKey)) +
      hostStageReservations +
      requestedBytes
    val projectedGlobalBytes = logicalByteLength(cacheRoot) +
      allStageReservations +
      requestedBytes
    val plan = mobileWebCacheEvictionPlan(
      candidates = evictionCandidates(),
      targetHostKey = hostKey,
      projectedHostBytes = projectedHostBytes,
      projectedGlobalBytes = projectedGlobalBytes
    ) ?: throw IllegalArgumentException("mobile_web_cache_quota_exceeded")
    plan.forEach { candidate ->
      require(candidate.root.deleteRecursively()) { "mobile_web_cache_quota_exceeded" }
    }

    val reservedFreeBytes = allStageReservations + requestedBytes
    val available = availableStorageBytes(cacheRoot)
    if (available > 0 && available < reservedFreeBytes + MOBILE_WEB_MINIMUM_FREE_STORAGE_BYTES) {
      throw IllegalArgumentException("mobile_web_cache_storage_unavailable")
    }
  }

  private fun evictionCandidates(): List<MobileWebCacheGenerationCandidate> =
    cacheRoot.listFiles()
      ?.filter { it.isDirectory && SHA256_PATTERN.matches(it.name) }
      ?.flatMap { hostRoot ->
        val generationRoots = File(hostRoot, "generations").listFiles()
          ?.filter { it.isDirectory && SHA256_PATTERN.matches(it.name) }
          .orEmpty()
        val buildIds = generationRoots.map { it.name }.toSet()
        val protected = sessions.values
          .filter { it.hostKey == hostRoot.name }
          .mapTo(mutableSetOf()) { it.buildId }
        val activation = File(hostRoot, "activation.json")
        if (activation.exists()) {
          runCatching { readActivation(hostRoot) }
            .onSuccess { value ->
              protected += value.first
              value.second?.let { protected += it }
            }
            // Why: unreadable activation state must fail closed instead of deleting a possible rollback.
            .onFailure { protected += buildIds }
        }
        generationRoots
          .filter { it.name !in protected }
          .map { generationRoot ->
            MobileWebCacheGenerationCandidate(
              hostKey = hostRoot.name,
              buildId = generationRoot.name,
              byteLength = logicalByteLength(generationRoot),
              modifiedAtMillis = generationRoot.lastModified(),
              root = generationRoot
            )
          }
      }
      .orEmpty()

  private fun cleanupOrphanedWrites() {
    try {
      val liveStageRoots = stages.values.mapTo(mutableSetOf()) { it.root.canonicalPath }
      cacheRoot.listFiles()
        ?.filter { it.isDirectory && SHA256_PATTERN.matches(it.name) }
        ?.forEach { hostRoot ->
          File(hostRoot, "staging").listFiles()?.forEach { stagedRoot ->
            if (stagedRoot.canonicalPath !in liveStageRoots) {
              require(stagedRoot.deleteRecursively()) { "mobile_web_cache_cleanup_failed" }
            }
          }
          hostRoot.listFiles()
            ?.filter { it.name.startsWith("activation-") && it.extension == "tmp" }
            ?.forEach { temporary ->
              require(temporary.delete()) { "mobile_web_cache_cleanup_failed" }
            }
        }
    } catch (error: Exception) {
      throw storageException(error, "mobile_web_cache_cleanup_failed")
    }
  }

  private fun logicalByteLength(root: File): Long {
    if (!root.exists()) return 0
    if (root.isFile) return root.length()
    return root.walkTopDown().filter { it.isFile }.sumOf { it.length() }
  }

  private fun validatedHostKey(hostIdentity: String): String {
    val bytes = hostIdentity.toByteArray(Charsets.UTF_8)
    require(bytes.isNotEmpty() && bytes.size <= 8 * 1024) { "mobile_web_host_identity_invalid" }
    return sha256Hex(bytes)
  }

  private fun sessionResponse(sessionId: String, buildId: String): Map<String, String> = mapOf(
    "sessionId" to sessionId,
    "buildId" to buildId,
    "url" to "$MOBILE_WEB_ORIGIN/#$sessionId"
  )

  private fun requireStage(stageId: String): MobileWebStageRecord =
    stages[stageId] ?: throw IllegalArgumentException("mobile_web_stage_unknown")
}

internal fun requireMobileWebAssetParent(file: File) {
  val parent = requireNotNull(file.parentFile) { "mobile_web_stage_create_failed" }
  require(parent.mkdirs() || parent.isDirectory) { "mobile_web_stage_create_failed" }
}

internal object MobileWebShellEnvironment {
  @Volatile
  private var packageStore: MobileWebPackageStore? = null

  fun packageStore(context: Context): MobileWebPackageStore =
    packageStore ?: synchronized(this) {
      packageStore ?: MobileWebPackageStore(context.applicationContext).also { packageStore = it }
    }
}

private fun parseJsonObject(value: String): JSONObject = try {
  JSONObject(value)
} catch (_: Exception) {
  throw IllegalArgumentException("mobile_web_stage_manifest_invalid")
}

private fun assetFile(root: File, path: String): File =
  path.split('/').fold(root) { parent, component -> File(parent, component) }

private fun isSafeAssetPath(path: String): Boolean =
  path.length in 1..240 &&
    !path.startsWith('/') &&
    !path.endsWith('/') &&
    !path.contains("//") &&
    !path.contains('\\') &&
    !path.contains('?') &&
    !path.contains('#') &&
    SAFE_PATH_PATTERN.matches(path) &&
    path.split('/').all { it != "." && it != ".." }

private fun isValidAssetMetadata(
  path: String,
  hash: String,
  contentType: String,
  role: String
): Boolean {
  if (role == "document") {
    return path == "index.html" && contentType == "text/html; charset=utf-8"
  }
  val expected = mapOf(
    "css" to ("text/css; charset=utf-8" to "style"),
    "js" to ("text/javascript; charset=utf-8" to "script"),
    "png" to ("image/png" to "image"),
    "svg" to ("image/svg+xml; charset=utf-8" to "image"),
    "wasm" to ("application/wasm" to "wasm"),
    "webp" to ("image/webp" to "image"),
    "woff2" to ("font/woff2" to "font")
  )
  val components = path.split('/')
  if (components.size != 2 || components[0] != "assets") return false
  val separator = components[1].lastIndexOf('.')
  if (separator <= 0) return false
  val fileHash = components[1].substring(0, separator)
  val extension = components[1].substring(separator + 1)
  val expectedMetadata = expected[extension] ?: return false
  return fileHash == hash && expectedMetadata.first == contentType && expectedMetadata.second == role
}

private fun strictJsonInt(value: JSONObject, key: String): Int? = value.opt(key) as? Int

private fun strictJsonString(value: JSONObject, key: String): String? = value.opt(key) as? String

private fun sha256Hex(bytes: ByteArray): String =
  MessageDigest.getInstance("SHA-256").digest(bytes).joinToString("") { "%02x".format(it) }

private fun randomIdentifier(): String {
  val bytes = ByteArray(32)
  SecureRandom().nextBytes(bytes)
  return Base64.getUrlEncoder().withoutPadding().encodeToString(bytes)
}

private fun replaceActivationFile(source: File, destination: File) {
  Os.rename(source.path, destination.path)
}

private fun storageException(error: Exception, fallback: String): IllegalArgumentException {
  if (error is IllegalArgumentException && error.message?.startsWith("mobile_web_") == true) {
    return error
  }
  return IllegalArgumentException(
    if (isStorageUnavailable(error)) "mobile_web_cache_storage_unavailable" else fallback
  )
}

private fun isStorageUnavailable(error: Throwable?): Boolean {
  if (error == null) return false
  if (error is IOException && error.message?.contains("ENOSPC", ignoreCase = true) == true) {
    return true
  }
  return isStorageUnavailable(error.cause)
}

private fun jsonEquivalent(left: Any?, right: Any?): Boolean {
  if (left is JSONObject && right is JSONObject) {
    val leftKeys = left.keys().asSequence().toSet()
    val rightKeys = right.keys().asSequence().toSet()
    return leftKeys == rightKeys && leftKeys.all { jsonEquivalent(left.get(it), right.get(it)) }
  }
  if (left is JSONArray && right is JSONArray) {
    return left.length() == right.length() &&
      (0 until left.length()).all { jsonEquivalent(left.get(it), right.get(it)) }
  }
  return left == right
}
