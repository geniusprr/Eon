import { contextBridge, ipcRenderer, webUtils } from 'electron'
import type { DesktopEventName, ElectronDesktopBridge, IpcChannel } from '../../shared/contracts.js'

/**
 * Eon 2 window bridge. Legacy browser, Vault, LibreChat, shell and power
 * command channels are deliberately absent from the new renderer process.
 */
const channels = new Set<string>([
  'window:minimize', 'window:toggle-maximize', 'window:is-maximized', 'window:close', 'window:show',
  'eon2:system-snapshot', 'eon2:deck:get', 'eon2:deck:layout:get', 'eon2:deck:layout:set', 'eon2:deck:execute', 'eon2:devices', 'eon2:paired-devices',
  'eon2:mobile:status', 'eon2:mobile:install', 'eon2:mobile:install-apk',
  'eon2:theme:set',
  'eon2:settings:get', 'eon2:settings:set', 'eon2:settings:import', 'eon2:settings:export', 'eon2:files:drop', 'eon2:actions:drop', 'eon2:pairing:state',
  'eon2:actions:list', 'eon2:actions:save', 'eon2:actions:delete', 'eon2:actions:execute', 'eon2:actions:pick-app',
  'eon2:ai:state', 'eon2:ai:configure', 'eon2:ai:connect', 'eon2:ai:models', 'eon2:ai:send',
  'eon2:ai:pending', 'eon2:ai:approve', 'eon2:ai:reject',
  'eon2:files:list', 'eon2:files:offer', 'eon2:files:cancel', 'eon2:permissions:set',
  'eon2:files:directory', 'eon2:files:choose-directory', 'eon2:files:open-directory', 'eon2:files:open', 'eon2:files:save-as',
  'eon2:pairing:begin', 'eon2:pairing:cancel', 'eon2:pairing:revoke',
  'eon2:tailnet:get', 'eon2:tailnet:refresh', 'eon2:tailnet:set',
  'eon2:scrcpy:status', 'eon2:scrcpy:start', 'eon2:scrcpy:stop', 'eon2:scrcpy:mode', 'eon2:scrcpy:layout',
  'eon2:notes:list', 'eon2:notes:history', 'eon2:notes:save', 'eon2:notes:delete',
  'eon2:notes:conflicts', 'eon2:notes:manifest', 'eon2:notes:identity', 'eon2:notes:resolve',
])

const bridge: ElectronDesktopBridge = {
  pathsForDroppedFiles(files) {
    if (files.length > 20) throw new Error('Bir seferde en fazla 20 dosya bırakabilirsin.')
    const paths = files.map(file => webUtils.getPathForFile(file))
    if (paths.some(path => !path)) throw new Error('Windows Gezgini’nden yerel bir dosya bırak.')
    return paths
  },
  invoke(channel: IpcChannel, payload?: unknown) {
    if (!channels.has(channel)) return Promise.reject(new Error('Eon 2 IPC capability denied'))
    return ipcRenderer.invoke(channel, payload)
  },
  on(event: DesktopEventName, listener: (payload: unknown) => void) {
    if (event !== 'eon2:scrcpy:changed' && event !== 'eon2:ai:navigate' && event !== 'eon2:theme:changed') throw new Error('Eon 2 olayına erişim reddedildi.')
    const callback = (_event: Electron.IpcRendererEvent, payload: unknown) => listener(payload)
    ipcRenderer.on(event, callback)
    return () => { ipcRenderer.off(event, callback) }
  },
}

contextBridge.exposeInMainWorld('kapanisDesktop', bridge)
