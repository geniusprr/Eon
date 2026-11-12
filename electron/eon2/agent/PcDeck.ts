import type { PcAction } from '../../../shared/eon-controls.js'
import type { RemotePermission } from '../transport/UsbPairingServer.js'

const deckTools = {
  explorer: { name: 'Dosyalar', icon: 'folder' },
  terminal: { name: 'Terminal', icon: 'terminal' },
  tasks: { name: 'Görev Yöneticisi', icon: 'chart' },
  settings: { name: 'Windows Ayarları', icon: 'settings' },
} as const
const mediaKeys = ['previous', 'playPause', 'next', 'mute', 'volumeDown', 'volumeUp'] as const
const powerKinds: readonly PcAction['kind'][] = ['lock', 'shutdown', 'restart', 'cancel']
export type DeckTool = keyof typeof deckTools
export type DeckMediaKey = typeof mediaKeys[number]

export function isPowerAction(kind: PcAction['kind']) { return powerKinds.includes(kind) }

export function describeDeck(actions: readonly PcAction[], permissions: readonly RemotePermission[], windowsAvailable: boolean) {
  const shortcutsAllowed = permissions.includes('actions.execute')
  const powerAllowed = permissions.includes('power.manage')
  return {
    shortcutsAllowed,
    powerAllowed,
    mediaAvailable: windowsAvailable && shortcutsAllowed,
    tools: windowsAvailable ? Object.entries(deckTools).map(([id, tool]) => ({ id, ...tool })) : [],
    actions: actions.map(({ id, name, kind, remoteEnabled, icon }) => ({
      id, name, kind, remoteEnabled, ...(icon ? { icon } : {}),
      available: windowsAvailable && remoteEnabled && (isPowerAction(kind) ? powerAllowed : shortcutsAllowed),
    })),
  }
}

export function parseDeckCommand(value: unknown): { type: 'tool'; id: DeckTool } | { type: 'media'; id: DeckMediaKey } {
  if (!value || typeof value !== 'object' || !('id' in value) || typeof value.id !== 'string') throw new Error('Geçersiz panel komutu.')
  const id = value.id
  if (Object.hasOwn(deckTools, id)) return { type: 'tool', id: id as DeckTool }
  const key = mediaKeys.find(item => item === id)
  if (key) return { type: 'media', id: key }
  throw new Error('Geçersiz panel komutu.')
}
