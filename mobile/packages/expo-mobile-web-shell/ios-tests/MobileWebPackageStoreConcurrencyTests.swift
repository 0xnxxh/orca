import CryptoKit
import Foundation

enum MobileWebPackageStoreConcurrencyTests {
  static func run(root: URL) throws {
    try exerciseIndependentHosts(root: root.appendingPathComponent("hosts"))
    try exerciseDuplicateGeneration(root: root.appendingPathComponent("duplicate"))
  }

  private static func exerciseIndependentHosts(root: URL) throws {
    let store = MobileWebPackageStore(cacheRoot: root)
    let failures = ConcurrentFailureCollector()

    DispatchQueue.concurrentPerform(iterations: 24) { index in
      do {
        let host = "concurrent-host-\(index)"
        let fixture = try concurrencyFixture(content: "<title>\(index)</title>")
        try concurrencyStagePackage(store: store, host: host, fixture: fixture)
        let session = try store.openSession(
          hostIdentity: host,
          buildId: fixture.buildId,
          bridgeVersion: 1
        )
        let sessionId = session["sessionId"]!
        let asset = try store.readAsset(sessionId: sessionId, path: "index.html")
        precondition(asset.data == fixture.bytes)
        let activeBuildId = try store.markSessionHealthy(sessionId: sessionId)
        precondition(activeBuildId == fixture.buildId)
        store.closeSession(sessionId: sessionId)
      } catch {
        failures.append(error)
      }
    }

    precondition(failures.isEmpty)
  }

  private static func exerciseDuplicateGeneration(root: URL) throws {
    let store = MobileWebPackageStore(cacheRoot: root)
    let fixture = try concurrencyFixture(content: "<title>same generation</title>")
    let failures = ConcurrentFailureCollector()

    DispatchQueue.concurrentPerform(iterations: 24) { _ in
      do {
        try concurrencyStagePackage(store: store, host: "same-host", fixture: fixture)
      } catch {
        failures.append(error)
      }
    }

    precondition(failures.isEmpty)
    DispatchQueue.concurrentPerform(iterations: 24) { _ in
      do {
        let session = try store.openSession(
          hostIdentity: "same-host",
          buildId: fixture.buildId,
          bridgeVersion: 1
        )
        let sessionId = session["sessionId"]!
        let asset = try store.readAsset(sessionId: sessionId, path: "index.html")
        precondition(asset.data == fixture.bytes)
        let activeBuildId = try store.markSessionHealthy(sessionId: sessionId)
        precondition(activeBuildId == fixture.buildId)
        store.closeSession(sessionId: sessionId)
      } catch {
        failures.append(error)
      }
    }
    precondition(failures.isEmpty)
    let active = try store.openSession(
      hostIdentity: "same-host",
      buildId: nil,
      bridgeVersion: 1
    )
    let activeAsset = try store.readAsset(sessionId: active["sessionId"]!, path: "index.html")
    precondition(activeAsset.data == fixture.bytes)
    let staging =
      root
      .appendingPathComponent(concurrencySha256(Data("same-host".utf8)))
      .appendingPathComponent("staging")
    let remaining = try? FileManager.default.contentsOfDirectory(atPath: staging.path)
    precondition(remaining?.isEmpty != false)
  }
}

private final class ConcurrentFailureCollector: @unchecked Sendable {
  private let lock = NSLock()
  private var failures = [String]()

  var isEmpty: Bool {
    lock.lock()
    defer { lock.unlock() }
    return failures.isEmpty
  }

  func append(_ error: Error) {
    lock.lock()
    failures.append(error.localizedDescription)
    lock.unlock()
  }
}

private struct ConcurrencyFixture: Sendable {
  let bytes: Data
  let canonical: String
  let manifest: String
  let buildId: String
}

private func concurrencyStagePackage(
  store: MobileWebPackageStore,
  host: String,
  fixture: ConcurrencyFixture
) throws {
  let stageId = try store.beginStage(
    hostIdentity: host,
    manifestJson: fixture.manifest,
    canonicalManifestJson: fixture.canonical
  )
  try store.writeAssetChunk(
    stageId: stageId,
    path: "index.html",
    offset: 0,
    dataBase64: fixture.bytes.base64EncodedString(),
    chunkSha256: concurrencySha256(fixture.bytes)
  )
  try store.finishAsset(stageId: stageId, path: "index.html")
  let committedBuildId = try store.commitStage(stageId: stageId)
  precondition(committedBuildId == fixture.buildId)
}

private func concurrencyFixture(content: String) throws -> ConcurrencyFixture {
  let bytes = Data(content.utf8)
  let canonicalObject: [String: Any] = [
    "schemaVersion": 1,
    "bridge": ["minimum": 1, "testedThrough": 1],
    "entrypoint": "index.html",
    "totalBytes": bytes.count,
    "assets": [
      [
        "path": "index.html",
        "sha256": concurrencySha256(bytes),
        "byteLength": bytes.count,
        "contentType": "text/html; charset=utf-8",
        "role": "document",
      ]
    ],
  ]
  let canonicalData = try JSONSerialization.data(
    withJSONObject: canonicalObject,
    options: [.sortedKeys]
  )
  let buildId = concurrencySha256(canonicalData)
  var manifestObject = canonicalObject
  manifestObject["buildId"] = buildId
  let manifestData = try JSONSerialization.data(
    withJSONObject: manifestObject,
    options: [.sortedKeys]
  )
  return ConcurrencyFixture(
    bytes: bytes,
    canonical: String(decoding: canonicalData, as: UTF8.self),
    manifest: String(decoding: manifestData, as: UTF8.self),
    buildId: buildId
  )
}

private func concurrencySha256(_ data: Data) -> String {
  SHA256.hash(data: data).map { String(format: "%02x", $0) }.joined()
}
