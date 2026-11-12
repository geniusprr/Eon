import { contextBridge, ipcRenderer } from 'electron'
import type { DesktopEventName, ElectronDesktopBridge, IpcChannel } from '../shared/contracts.js'

const allowedChannels: ReadonlySet<string> = new Set([
  'window:minimize', 'window:toggle-maximize', 'window:is-maximized', 'window:set-browser-focus', 'window:is-browser-focus', 'window:close', 'window:show',
  'open-external', 'launch-program', 'programs:list', 'programs:icon', 'programs:pick', 'website-icons:get',
  'system:get-timer-status', 'system:schedule-shutdown', 'system:cancel-shutdown', 'system:get-info',
  'system:get-autostart', 'system:set-autostart', 'settings:get', 'settings:save',
  'eon2:system-snapshot', 'eon2:deck:get', 'eon2:deck:execute',
  'eon2:actions:list', 'eon2:actions:save', 'eon2:actions:delete', 'eon2:actions:execute', 'eon2:actions:pick-app',
  'eon2:files:list', 'eon2:files:offer', 'eon2:files:cancel', 'eon2:permissions:set',
  'eon2:files:directory', 'eon2:files:choose-directory', 'eon2:files:open-directory', 'eon2:files:open', 'eon2:files:save-as',
  'eon2:devices', 'eon2:notes:list', 'eon2:notes:history', 'eon2:notes:save', 'eon2:notes:delete',
  'eon2:paired-devices', 'eon2:pairing:begin', 'eon2:pairing:cancel', 'eon2:pairing:revoke',
  'eon2:scrcpy:status', 'eon2:scrcpy:start', 'eon2:scrcpy:stop',
  'eon2:tailnet:get', 'eon2:tailnet:refresh', 'eon2:tailnet:set',
  'eon2:notes:conflicts', 'eon2:notes:manifest', 'eon2:notes:identity', 'eon2:notes:resolve',
  'alarms:list', 'alarms:get-active', 'alarms:create', 'alarms:cancel', 'alarms:stop-sound',
  'media:get-current', 'media:control',
  'browser:create-tab', 'browser:activate-tab', 'browser:close-tab', 'browser:navigate',
  'browser:reload', 'browser:back', 'browser:forward', 'browser:set-visible', 'browser:deactivate',
  'browser:set-bounds', 'browser:sync-metadata', 'browser:toggle-media', 'browser:media-control',
  'browser:media-volume', 'browser:set-theme', 'browser:debug-snapshot', 'browser:get-session',
  'browser:save-session', 'browser:duplicate-tab', 'browser:set-pinned', 'browser:set-muted',
  'browser:show-tab-menu', 'browser:list-history', 'browser:clear-history', 'browser:list-downloads',
  'browser:open-download', 'browser:show-download', 'browser:cancel-download', 'browser:remove-download',
  'browser:list-permissions', 'browser:set-permission', 'browser:clear-permission',
  'browser:get-features', 'browser:set-adblock', 'browser:install-extension-store', 'browser:install-extension-unpacked',
  'browser:set-extension-enabled', 'browser:remove-extension', 'browser:open-extension-options', 'browser:clear-browsing-data',
  'youtube-music:control', 'youtube-music:set-volume', 'youtube-music:sync-state',
  'notes:list', 'notes:save', 'notes:delete', 'notes:toggle-pin',
  'transfers:list', 'transfers:open', 'transfers:show-in-folder', 'transfers:delete', 'transfers:clear',
  'mobile:get-connection-info',
  'localsend:get-status', 'localsend:get-devices', 'localsend:scan-network', 'localsend:send-text',
  'localsend:send-file', 'localsend:send-cloud-file', 'localsend:get-received-files', 'localsend:open-download-folder',
  'localsend:set-auto-accept', 'localsend:add-manual-device',
  'remote-desktop:get-status', 'remote-desktop:set-enabled', 'remote-desktop:stop-session',
  'remote-desktop:list-trusted-devices', 'remote-desktop:revoke-trusted-device', 'remote-desktop:revoke-all-trusted-devices',
  'vault:select-folder', 'vault:get-default-path', 'vault:list-entries', 'vault:read-file',
  'vault:write-file', 'vault:create-file', 'vault:create-folder', 'vault:rename-entry',
  'vault:delete-entry', 'vault:reveal-in-explorer', 'vault:start-watcher', 'vault:stop-watcher',
  'vault:set-window-mode',
  'notifications:get-history', 'notifications:test', 'notifications:get-status', 'notifications:clear-history',
  'ai:get-state', 'ai:get-messages', 'ai:create-conversation', 'ai:delete-conversation',
  'ai:set-provider', 'ai:send-message', 'ai:clear-cache',
  'librechat:activate', 'librechat:set-bounds', 'librechat:set-theme', 'librechat:deactivate',
])

// Keep the allowlist literal in the isolated preload so a remote page can never
// turn an arbitrary renderer event or channel into a Node/Electron capability.
const allowedEvents: ReadonlySet<string> = new Set([
  'browser:tab-created', 'browser:tab-updated', 'browser:tab-destroyed', 'browser:media-updated',
  'browser:open-request', 'browser:renderer-failed', 'browser:permission-request', 'browser:fullscreen-changed',
  'browser:download-updated', 'browser:history-updated', 'alarm:triggered', 'alarm:created', 'alarm:cancelled',
  'remote:command', 'mobile:note', 'mobile:file', 'mobile:notification', 'notification:mirrored', 'localsend:device-discovered',
  'localsend:file-received', 'vault:fs-change', 'youtube-music-state',
  'ai:updated', 'app:agent-action',
  'remote-desktop:state',
  'window:browser-focus-changed',
  'window:browser-focus-shortcut',
  'app:update-status',
])

const bridge: ElectronDesktopBridge = {
  invoke(channel: IpcChannel, payload?: unknown) {
    if (!allowedChannels.has(channel)) return Promise.reject(new Error(`IPC kanalı izinli değil: ${channel}`))
    return ipcRenderer.invoke(channel, payload)
  },
  on(event: DesktopEventName, listener: (payload: unknown) => void) {
    if (!allowedEvents.has(event)) throw new Error(`IPC olayı izinli değil: ${event}`)
    const handler = (_ipcEvent: Electron.IpcRendererEvent, payload: unknown) => listener(payload)
    ipcRenderer.on(event, handler)
    return () => ipcRenderer.removeListener(event, handler)
  },
}

contextBridge.exposeInMainWorld('kapanisDesktop', bridge)
