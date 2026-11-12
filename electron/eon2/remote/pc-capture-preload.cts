import { contextBridge, ipcRenderer } from 'electron'

contextBridge.exposeInMainWorld('eonPcCapture', {
  start: (listener: (config: unknown) => void) =>
    ipcRenderer.once('eon2:pc-capture:start', (_event, config: unknown) => listener(config)),
  frame: (packet: unknown) => ipcRenderer.send('eon2:pc-capture:frame', packet),
  error: (message: string) => ipcRenderer.send('eon2:pc-capture:error', message),
})
