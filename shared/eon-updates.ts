import type { AppUpdateStatus } from './contracts.js'

export interface CompanionRelease {
  version: string
  versionCode: number
  packageId: 'com.kapanis.mobil.eon2.dev'
  url: string
  sha256: string
  size: number
}
export interface CompanionDeviceUpdate { serial: string; name: string; versionCode: number; needsUpdate: boolean }
export interface CompanionUpdateStatus {
  phase: 'current' | 'checking' | 'downloading' | 'downloaded' | 'installing' | 'error'
  version?: string
  progress?: number
  message: string
  devices: CompanionDeviceUpdate[]
}
export interface UpdateCenterState { desktop: AppUpdateStatus; mobile: CompanionUpdateStatus }
