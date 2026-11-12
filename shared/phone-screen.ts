export type PhoneScreenMode = 'embedded' | 'window' | 'pip'
export type PhoneScreenStatus =
  | { state: 'idle' }
  | { state: 'error'; message: string }
  | { state: 'starting' | 'running'; serial: string; startedAt: number; mode: PhoneScreenMode }

export interface PhoneScreenSlot {
  x: number
  y: number
  width: number
  height: number
  viewportWidth: number
  viewportHeight: number
}
