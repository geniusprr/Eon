export type TimerAction = 'shutdown' | 'restart'

export interface TimerState {
  action: TimerAction
  targetAt: number
  durationSeconds: number
  shortcutId?: string
}

export type AlarmSoundProfile = 'gentle' | 'chime' | 'urgent'

export interface Alarm {
  id: string
  timestamp: number
  note: string
  createdAt: number
  intervalSeconds: number | null
  remainingOccurrences: number | null
  soundEnabled: boolean
  soundProfile: AlarmSoundProfile
}

export interface CreateAlarmInput {
  timestamp: number
  note: string
  intervalSeconds: number | null
  occurrenceCount: number | null
  soundEnabled: boolean
  soundProfile: AlarmSoundProfile
}

export interface AppSettings {
  supabaseUrl: string
  supabaseAnonKey: string
  deviceId: string
  deviceName: string
  pairingCode: string
  pairingSecret: string
  autostart: boolean
  heartbeatIntervalSeconds: number
  lastSavedAt: number
  notificationMirroringEnabled?: boolean
  ntfyEnabled?: boolean
  ntfyTopic?: string
  ntfyServer?: string
  remoteDesktopEnabled?: boolean
  language?: string
}

export interface MirroredNotification {
  id: string
  notificationId?: number | string
  appName: string
  title: string
  body: string
  timestamp: number
  source: 'windows' | 'test' | 'manual'
}

export interface PairedPcDevice {
  id: string
  name: string
  pairingCode: string
  pairingSecret: string
  supabaseUrl: string
  supabaseAnonKey: string
  localIps?: string[]
  localPort?: number
  ntfyTopic?: string
  lastConnectedAt?: number
  isOnline?: boolean
  lastSeenAt?: string
  timerState?: TimerState | null
  authSource?: 'cloud' | 'local'
}

export interface PairingPayload {
  v: number
  id: string
  name: string
  code: string
  secret: string
  url: string
  key: string
  ips?: string[]
  port?: number
  ntfy?: string
}

export interface PairedController {
  id: string
  deviceId: string
  controllerId: string
  controllerName: string
  controllerType: string
  lastActiveAt: string
  createdAt: string
}

export type RemoteCommandKind = TimerAction | 'cancel'

export interface RemoteCommand {
  id: string
  deviceId: string
  controllerId?: string
  command: RemoteCommandKind
  delaySeconds: number
  status: 'pending' | 'processing' | 'completed' | 'rejected'
  errorMessage?: string | null
  createdAt: string
  expiresAt: string
  completedAt?: string | null
}

export interface DeviceRecord {
  id: string
  name: string
  pairingCode: string
  pairingSecret: string
  isOnline: boolean
  lastSeenAt: string
  timerState: TimerState | null
  systemInfo?: Record<string, unknown> | null
  createdAt: string
  updatedAt: string
}

export type RemoteConnectionStatus = 'disconnected' | 'connecting' | 'connected' | 'error'

export interface NoteItem {
  id: string
  content: string
  createdAt: number
  updatedAt: number
  pinned: boolean
}

export interface TransferItem {
  id: string
  filename: string
  path: string
  size: number
  mimeType: string
  createdAt: number
  isImage: boolean
}

export interface LocalSendDevice {
  ip: string
  port: number
  alias: string
  version: string
  deviceModel?: string | null
  deviceType: 'mobile' | 'desktop' | 'web' | 'headless' | 'server' | string
  fingerprint: string
  protocol: 'http' | 'https' | string
  download: boolean
  lastSeen: number
}

export interface ReceivedFileRecord {
  id: string
  fileName: string
  size: number
  senderAlias: string
  senderIp: string
  localPath: string
  isText: boolean
  textPreview?: string | null
  receivedAt: number
}

export interface LocalSendStatus {
  isRunning: boolean
  localIp: string
  allIps: string[]
  port: number
  alias: string
  fingerprint: string
  autoAccept: boolean
  downloadDir: string
  discoveredCount: number
}

export interface RemoteDisplayInfo {
  width: number
  height: number
  scaleFactor: number
}

export type RemoteDesktopConnectionState = 'disabled' | 'ready' | 'connecting' | 'connected' | 'locked' | 'error'

export interface RemoteDesktopStatus {
  state: RemoteDesktopConnectionState
  sessionId: string | null
  controllerId: string | null
  controllerName: string | null
  display: RemoteDisplayInfo | null
  lastError: string | null
}

export interface RemoteTrustedDevice {
  id: string
  controllerId: string
  controllerName: string
  createdAt: number
  lastActiveAt: number
}

export type RemoteDesktopInput =
  | { version: 1; sequence: number; type: 'move'; x: number; y: number }
  | { version: 1; sequence: number; type: 'moveRelative'; dx: number; dy: number }
  | { version: 1; sequence: number; type: 'button'; button: 'left' | 'right' | 'middle'; pressed: boolean }
  | { version: 1; sequence: number; type: 'wheel'; deltaX: number; deltaY: number }
  | { version: 1; sequence: number; type: 'key'; code: string; pressed: boolean; modifiers?: string[] }
  | { version: 1; sequence: number; type: 'text'; value: string }
  | { version: 1; sequence: number; type: 'releaseAll' }

export interface RemoteIceCandidate {
  candidate: string
  sdpMid?: string | null
  sdpMLineIndex?: number | null
  usernameFragment?: string | null
}

export type RemoteDesktopSignal =
  | { version: 1; type: 'offer' | 'answer'; sdp: string }
  | { version: 1; type: 'ice'; candidate: RemoteIceCandidate }
  | { version: 1; type: 'state'; state: 'ready' | 'connecting' | 'connected' | 'failed' | 'closed'; reason?: string | null }
  | { version: 1; type: 'heartbeat' }
  | { version: 1; type: 'close'; reason?: string | null }

export interface ConnectionInfo {
  port: number
  ipAddresses: string[]
  deviceName: string
  qrPayload: string
}

export interface MobileNotification {
  id: string
  title: string
  message: string
  urgent: boolean
  createdAt: number
}
