import { requireNativeModule } from 'expo-modules-core'

export type CommittedMobileWebGeneration = {
  buildId: string
}

export type MobileWebShellSession = {
  sessionId: string
  buildId: string
  url: string
}

type ExpoMobileWebShellNativeModule = {
  beginStage(
    hostIdentity: string,
    manifestJson: string,
    canonicalManifestJson: string
  ): Promise<string>
  writeAssetChunk(
    stageId: string,
    path: string,
    offset: number,
    dataBase64: string,
    chunkSha256: string
  ): Promise<void>
  finishAsset(stageId: string, path: string): Promise<void>
  commitStage(stageId: string): Promise<CommittedMobileWebGeneration>
  abortStage(stageId: string): Promise<void>
  openSession(
    hostIdentity: string,
    buildId: string | null,
    bridgeVersion: number
  ): Promise<MobileWebShellSession>
  recoverSession(sessionId: string): Promise<MobileWebShellSession>
  markSessionHealthy(sessionId: string): Promise<CommittedMobileWebGeneration>
  closeSession(sessionId: string): Promise<void>
  removeHost(hostIdentity: string): Promise<void>
  activateViewSession(sessionId: string): Promise<void>
  deactivateViewSession(sessionId: string): Promise<void>
  postViewMessage(sessionId: string, message: string): Promise<void>
}

export default requireNativeModule<ExpoMobileWebShellNativeModule>('ExpoMobileWebShell')
