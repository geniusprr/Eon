export type PcActionKind = 'application' | 'file' | 'command' | 'lock' | 'shutdown' | 'restart' | 'cancel'
export const actionIconIds = ['app', 'code', 'globe', 'gamepad', 'music', 'video', 'camera', 'image', 'folder', 'file', 'terminal', 'settings', 'star', 'heart', 'zap', 'coffee', 'headphones', 'mail', 'calendar', 'book'] as const
export type ActionIconId = typeof actionIconIds[number]
export interface PcAction {
  id: string
  name: string
  kind: PcActionKind
  target: string
  arguments: string[]
  delaySeconds: number
  remoteEnabled: boolean
  icon?: ActionIconId
}
export interface TransferFile {
  id: string
  fileName: string
  size: number
  fileType: string
  direction: 'send' | 'receive'
  deviceId: string
  transferred: number
  state: 'queued' | 'transferring' | 'completed' | 'cancelled'
}
export const FILE_CHUNK_BYTES = 256 * 1024
