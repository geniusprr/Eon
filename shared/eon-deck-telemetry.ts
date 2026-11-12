/** Local Windows telemetry. Null means the Windows adapter or sample is unavailable. */
export interface DeckGpuSample {
  usagePercent: number
  temperatureC: number | null
}

export interface DeckMediaSample {
  title: string
  artist: string
  /** Bounded, locally supplied JPEG/PNG artwork; never a remote URL. */
  artwork?: string | null
  playing: boolean
}

export interface DeckDiskSample {
  name: string
  totalBytes: number
  usedBytes: number
  usagePercent: number
}

export interface DeckNetworkInterface {
  name: string
  receivedBytes: number
  sentBytes: number
  receiveBytesPerSecond: number | null
  sendBytesPerSecond: number | null
}

export interface DeckNetworkSample {
  sampledAt: number
  receiveBytesPerSecond: number | null
  sendBytesPerSecond: number | null
  interfaces: DeckNetworkInterface[]
}

/** The Android /v1/deck endpoint spreads these fields into its authorized deck description. */
export interface DeckTelemetrySnapshot {
  sampledAt: number
  gpu: DeckGpuSample | null
  disks: DeckDiskSample[]
  network: DeckNetworkSample | null
  /** Omitted unless the requesting device has actions.execute permission. */
  media?: DeckMediaSample | null
}

export interface DeckDescription {
  shortcutsAllowed: boolean
  powerAllowed: boolean
  mediaAvailable: boolean
  tools: Array<{ id: string; name: string; icon: string }>
  actions: Array<{ id: string; name: string; kind: string; remoteEnabled: boolean; available: boolean; delaySeconds?: number; activeUntil?: number }>
}

/** Desktop eon2:deck:get; Android /v1/deck has the same shape after permission filtering. */
export type DeckDesktopSnapshot = DeckDescription & DeckTelemetrySnapshot

export type DeckMediaCommand = 'previous' | 'playPause' | 'next' | 'mute' | 'volumeDown' | 'volumeUp'

export type DeckToolId = 'explorer' | 'terminal' | 'tasks' | 'settings'

/** Desktop IPC: eon2:deck:get -> DeckDesktopSnapshot; eon2:deck:execute <- { id } -> { ok: true }. */
export interface DeckCommandRequest { id: DeckToolId | DeckMediaCommand }
