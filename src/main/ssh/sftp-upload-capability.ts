import type {
  mkdirSftp,
  uploadBuffer,
  uploadDirectory,
  uploadFile,
  writeStringViaSftp
} from './sftp-upload'

export type SftpUploadCapability = {
  mkdirSftp: typeof mkdirSftp
  uploadBuffer: typeof uploadBuffer
  uploadDirectory: typeof uploadDirectory
  uploadFile: typeof uploadFile
  writeStringViaSftp: typeof writeStringViaSftp
}

export function loadSftpUploadCapability(): Promise<SftpUploadCapability> {
  return import('./sftp-upload')
}
