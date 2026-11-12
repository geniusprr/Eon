import { app, dialog, ipcMain, safeStorage, shell, type IpcMainInvokeEvent } from 'electron'
import { isAppTheme, type AppTheme } from '../../src/theme.js'
import { execFile, spawn } from 'node:child_process'
import { promisify } from 'node:util'
import { PcActions } from './agent/PcActions.js'
import { describeDeck, isPowerAction, parseDeckCommand } from './agent/PcDeck.js'
import { WindowsInputInjector } from '../WindowsInputInjector.js'
import { WindowsDeckTelemetry } from './agent/WindowsDeckTelemetry.js'
import { FileTransfers } from './agent/FileTransfers.js'
import { SystemManager } from '../SystemManager.js'
import path from 'node:path'
import fs from 'node:fs'
import { randomUUID } from 'node:crypto'
import { WindowManager } from '../WindowManager.js'
import { SystemTelemetry } from './agent/SystemTelemetry.js'
import { NotesRepository, type NoteSaveInput } from './notes/NotesRepository.js'
import { AdbService, AuthorizedUsbSessionTracker } from './transport/AdbService.js'
import { DeviceCredentials } from './transport/DeviceCredentials.js'
import { UsbPairingServer, EON_USB_PORT } from './transport/UsbPairingServer.js'
import { ScrcpyManager, type ScrcpyOptions } from './remote/ScrcpyManager.js'
import { ScrcpyPresentation } from './remote/ScrcpyPresentation.js'
import { PcRemoteDesktop } from './remote/PcRemoteDesktop.js'
import { TailscaleDetector, type TailnetStatus } from './transport/TailscaleDetector.js'
import { DeckLayoutConflictError, DeckLayoutStore } from './deck/DeckLayoutStore.js'
import { EonAiService } from './ai/EonAiService.js'
import { connectOpenRouter } from './ai/OpenRouterOAuth.js'
import { createWindowsShortcut, inspectWindowsApplication } from './agent/WindowsShortcuts.js'

/** Minimal Eon 2 process: it starts no browser, LibreChat, Supabase or LAN service. */
export async function startEon2Runtime(preloadPath: string, rendererTarget: string) {
  const windows = new WindowManager(preloadPath)
  const telemetry = new SystemTelemetry()
  const mobileResources = app.isPackaged ? path.join(process.resourcesPath, 'mobile') : path.join(app.getAppPath(), 'build', 'mobile')
  const adb = new AdbService(app.isPackaged ? path.join(mobileResources, 'adb.exe') : 'adb')
  const companionApk = path.join(mobileResources, 'Eon-Android.apk')
  const scrcpy = new ScrcpyManager(adb)
  const storage = path.join(app.getPath('userData'), 'eon-2')
  const tailnetSettingsPath = path.join(storage, 'tailnet-settings.json')
  const themePath = path.join(storage, 'theme.json')
  const loginArgs = app.isPackaged ? ['--background'] : [`"${app.getAppPath()}"`, '--background']
  let sharedTheme: AppTheme | null = null
  try {
    const saved: unknown = JSON.parse(fs.readFileSync(themePath, 'utf8'))
    if (typeof saved === 'string' && isAppTheme(saved)) sharedTheme = saved
  } catch { /* Existing renderer preference is imported on first launch. */ }
  let notifyPhoneRequest: (() => void) | undefined
  const tailnetDetector = new TailscaleDetector()
  let tailnetEnabled = false
  try { tailnetEnabled = JSON.parse(fs.readFileSync(tailnetSettingsPath, 'utf8')).enabled === true }
  catch { /* Disabled until explicit user opt-in. */ }
  let tailnetStatus: TailnetStatus = { installed:false, running:false, online:false, dnsName:null, ipv4:null }
  let tailnetReason: string | null = null
  let tailnetBusy = false
  const notes = new NotesRepository(path.join(storage, 'notes.sqlite'))
  const deckLayout = new DeckLayoutStore(path.join(storage, 'deck-layout.json'))
  const credentials = new DeviceCredentials(storage)
  const power = new SystemManager(path.join(storage, 'power'))
  const executeFile = promisify(execFile)
  const input = new WindowsInputInjector()
  const windowsDirectory = process.env.SystemRoot || 'C:\\Windows'
  const systemDirectory = path.join(windowsDirectory, 'System32')
  const deckTelemetry = new WindowsDeckTelemetry(systemDirectory)
  const actions = new PcActions(path.join(storage, 'pc-actions.json'), async action => {
    if (process.platform !== 'win32') throw new Error('PC eylemleri Windows gerektirir.')
    if (action.kind === 'shutdown' || action.kind === 'restart') return power.toggleShutdown(action.kind, action.delaySeconds, action.id)
    if (action.kind === 'cancel') return power.cancelShutdown()
    if (action.kind === 'lock') return executeFile(path.join(systemDirectory, 'rundll32.exe'), ['user32.dll,LockWorkStation'], { windowsHide: true, timeout: 5000 })
    if (action.kind === 'file') {
      const error = await shell.openPath(action.target)
      if (error) throw new Error(error)
      return
    }
    if (action.kind === 'application' && /\.lnk$/i.test(action.target)) {
      const error = await shell.openPath(action.target)
      if (error) throw new Error(error)
      return
    }
    if (action.kind === 'application') {
      await new Promise<void>((resolve, reject) => {
        const child = spawn(action.target, action.arguments, { detached: true, stdio: 'ignore', shell: false })
        child.once('error', reject)
        child.once('spawn', () => { child.unref(); resolve() })
      })
      return
    }
    return executeFile(path.join(systemDirectory, 'WindowsPowerShell', 'v1.0', 'powershell.exe'), ['-NoProfile', '-NonInteractive', '-EncodedCommand', Buffer.from(action.target, 'utf16le').toString('base64')], { windowsHide: true, timeout: 30_000, maxBuffer: 65536 })
  })
  let ai: EonAiService | null = null
  let pcRemote: PcRemoteDesktop | null = null
  const transfers = new FileTransfers(path.join(storage, 'Received'), path.join(storage, 'transfer-directory.json'))
  const usb = new UsbPairingServer(credentials, {
    remoteDesktop: (...args) => {
      if (!pcRemote) throw new Error('Ekran paylaşımı başlatılıyor.')
      pcRemote.route(...args)
    },
    remoteDisconnected: transport => pcRemote?.disconnect(transport),
    phoneApprovalRequested: () => notifyPhoneRequest?.(),
    deckLayoutGet: () => deckLayout.get(),
    deckLayoutSet: body => deckLayout.set(body),
    settings: (body, fromUsb) => {
      if (body === undefined) return settingsSnapshot()
      if ((body as { key?: unknown } | null)?.key === 'initialTheme') throw new Error('Yalnızca masaüstü teması içe aktarabilir.')
      return updateSettings(body, fromUsb)
    },
    controls: async (pathname, body, deviceId) => {
      if (pathname.startsWith('/v1/ai/')) {
        if (!ai) throw new Error('AI hizmeti henüz hazır değil.')
        if (pathname === '/v1/ai/state') return ai.state()
        if (pathname === '/v1/ai/models') return ai.models()
        if (pathname === '/v1/ai/send') {
          const permissions = credentials.list().find(device => device.id === deviceId)?.permissions ?? []
          return ai.send(body, { notesWrite: permissions.includes('notes.write'), systemRead: permissions.includes('system.read') })
        }
        if (pathname === '/v1/ai/pending') return ai.pending()
        if (pathname === '/v1/ai/approve') return ai.approve(readTextField(body, 'id', 90))
        if (pathname === '/v1/ai/reject') return { ok: ai.reject(readTextField(body, 'id', 90)) }
        throw new Error('Bilinmeyen AI işlemi.')
      }
      if (pathname === '/v1/deck') {
        const permissions = credentials.list().find(device => device.id === deviceId)?.permissions ?? []
        const deck = describeDeck(actions.list(), permissions, process.platform === 'win32', power.getTimerStatus())
        return { ...deck, ...deckTelemetry.snapshot(deck.shortcutsAllowed) }
      }
      if (pathname === '/v1/deck/execute') {
        if (process.platform !== 'win32') throw new Error('Bu işlem Windows gerektirir.')
        const command = parseDeckCommand(body)
        if (command.type === 'media') {
          if (!input.mediaKey(command.id)) throw new Error('Windows medya tuşunu kabul etmedi.')
        } else if (command.id === 'settings') {
          await shell.openExternal('ms-settings:')
        } else {
          const executable = command.id === 'explorer' ? path.join(windowsDirectory, 'explorer.exe')
            : path.join(systemDirectory, command.id === 'terminal' ? 'cmd.exe' : 'Taskmgr.exe')
          await new Promise<void>((resolve, reject) => {
            const child = spawn(executable, [], { detached: true, stdio: 'ignore', shell: false })
            child.once('error', reject)
            child.once('spawn', () => { child.unref(); resolve() })
          })
        }
        return { ok: true }
      }
      if (pathname === '/v1/files/list') return { files: transfers.list(deviceId) }
      if (pathname === '/v1/files/prepare') return transfers.prepare(deviceId, body)
      if (pathname === '/v1/files/chunk') return transfers.chunk(deviceId, body)
      if (pathname === '/v1/files/finish') return transfers.finish(deviceId, body)
      if (pathname === '/v1/files/cancel') {
        const id = readTextField(body, 'id', 90)
        if (!transfers.list(deviceId).some(file => file.id === id)) throw new Error('Dosyaya erişim yok.')
        return { ok: await transfers.cancel(id) }
      }
      if (pathname === '/v1/actions/list') return { actions: actions.list(), timer: power.getTimerStatus(), sampledAt: Date.now() }
      if (pathname === '/v1/actions/save') return actions.save(body, true)
      const id = readTextField(body, 'id', 90)
      const action = actions.list().find(item => item.id === id)
      const powerAction = Boolean(action && isPowerAction(action.kind))
      if (powerAction !== (pathname === '/v1/power/execute')) throw new Error('Yanlış eylem izni.')
      return actions.execute(id, true)
    },
    system: () => telemetry.snapshot(),
    notesList: () => notes.list(),
    vaultId: () => notes.identity().vaultId,
    notesManifest: () => notes.getManifest(),
    notesDelta: (remote) => notes.sendDelta(remote as Parameters<typeof notes.sendDelta>[0]),
    notesApply: (delta) => notes.receiveDelta(delta as Parameters<typeof notes.receiveDelta>[0]),
  })
  let usbReady = false
  try { await usb.start(); usbReady = true }
  catch (error) { console.warn('[eon2] USB agent unavailable', error instanceof Error ? error.message : 'unknown') }
  function tailnetSnapshot() {
    const listener = usb.getTailnetListener()
    return { enabled: tailnetEnabled, installed: tailnetStatus.installed, running: tailnetStatus.running,
      online: tailnetStatus.online, dnsName: tailnetStatus.dnsName,
      serving: Boolean(listener), port: listener?.port ?? null,
      reason: tailnetReason }
  }
  function settingsSnapshot() {
    return {
      theme: sharedTheme,
      tailscale: tailnetEnabled,
      autostart: process.platform === 'win32' && app.getLoginItemSettings({ path: process.execPath, args: loginArgs }).openAtLogin,
    }
  }
  async function updateSettings(value: unknown, canManageWindows: boolean) {
    if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('Geçersiz ayar.')
    const { key, value: next } = value as Record<string, unknown>
    if ((key === 'theme' || key === 'initialTheme') && typeof next === 'string' && isAppTheme(next)) {
      if (key === 'theme' || sharedTheme === null) {
        fs.writeFileSync(themePath, JSON.stringify(next), { mode: 0o600 })
        sharedTheme = next
        windows.setTheme(next === 'light' ? 'light' : 'dark')
        const renderer = windows.getMainWindow()?.webContents
        if (renderer && !renderer.isDestroyed()) renderer.send('eon2:theme:changed', next)
      }
    } else if (canManageWindows && key === 'autostart' && typeof next === 'boolean' && process.platform === 'win32') {
      app.setLoginItemSettings({ openAtLogin: next, path: process.execPath, args: loginArgs })
      if (settingsSnapshot().autostart !== next) throw new Error('Windows başlangıç ayarı kaydedilemedi.')
    } else if (canManageWindows && key === 'tailscale' && typeof next === 'boolean') {
      persistTailnetSetting(next)
      void applyTailnetSetting().catch(() => { tailnetReason = 'Tailscale ayarı uygulanamadı.' })
    } else throw new Error('Bu ayarı değiştirmek için USB bağlantısı veya masaüstü Eon gerekir.')
    return settingsSnapshot()
  }
  async function refreshTailnet() {
    if (tailnetBusy) return tailnetSnapshot()
    tailnetBusy = true
    try {
      tailnetStatus = await tailnetDetector.getStatus()
      if (!tailnetEnabled || !tailnetStatus.online || !usbReady || !tailnetStatus.ipv4 || !tailnetStatus.dnsName) {
        if (usb.getTailnetListener()) await usb.stopTailnet()
        tailnetReason = tailnetEnabled && !tailnetStatus.online ? 'Tailscale bağlantısı açık veya yetkilendirilmiş görünmüyor.'
          : tailnetEnabled && !usbReady ? 'Eon USB protokol sunucusu çalışmıyor.' : null
        return tailnetSnapshot()
      }
      const listener = usb.getTailnetListener()
      if (listener?.ip === tailnetStatus.ipv4 && listener?.dnsName === tailnetStatus.dnsName) {
        tailnetReason = null
        return tailnetSnapshot()
      }
      try {
        const certificate = await tailnetDetector.getHttpsCertificate(tailnetStatus.dnsName)
        if (!tailnetEnabled) return tailnetSnapshot()
        await usb.startTailnet({ ip: tailnetStatus.ipv4, dnsName: tailnetStatus.dnsName, ...certificate })
        if (!tailnetEnabled) await usb.stopTailnet()
        tailnetReason = null
      } catch {
        tailnetReason = 'Tailscale HTTPS sertifikası alınamadı veya arayüz portu açılamadı. HTTPS ve MagicDNS ayarlarını kontrol et.'
      }
    } finally { tailnetBusy = false }
    return tailnetSnapshot()
  }
  if (tailnetEnabled) void refreshTailnet()
  const tailnetInterval = setInterval(() => { void refreshTailnet() }, 60_000)
  tailnetInterval.unref?.()
  let attaching: Promise<void> | null = null
  let closing = false
  const previouslyAttached = new Map<string, number>()
  const companionSessions = new AuthorizedUsbSessionTracker()
  async function scanUsbDevices() {
    const devices = await adb.list(true)
    const newlyAuthorized = companionSessions.observe(devices)
    const connected = devices.filter(device => device.usb && device.state === 'device')
    const serials = new Set(connected.map(device => device.serial))
    for (const serial of previouslyAttached.keys()) if (!serials.has(serial)) {
      previouslyAttached.delete(serial)
      usb.detachUsb(serial)
    }
    for (const { serial } of connected) {
      if (closing) return
      if (!usbReady) continue
      const previousPort = previouslyAttached.get(serial)
      try {
        if (previousPort && await adb.hasReverse(serial, EON_USB_PORT, previousPort)) continue
        if (previousPort) usb.detachUsb(serial)
        const port = await usb.attachUsb(serial)
        if (closing) { usb.detachUsb(serial); return }
        await adb.enableReverse(serial, EON_USB_PORT, port)
        if (closing) { usb.detachUsb(serial); return }
        previouslyAttached.set(serial, port)
      } catch {
        previouslyAttached.delete(serial)
        usb.detachUsb(serial)
      }
    }
    // Open only once per authorized physical USB session, including at desktop startup.
    // Installing, approving pairing and initiating remote control remain explicit actions.
    for (const serial of newlyAuthorized) {
      if (closing) return
      void adb.openCompanion(serial).catch(error => {
        if (!closing) console.warn('[eon2] Cannot open phone companion', serial, error instanceof Error ? error.message : 'unknown')
      })
    }
  }
  function attachUsbDevices(): Promise<void> {
    if (closing) return Promise.resolve()
    if (attaching) return attaching
    attaching = scanUsbDevices().catch(() => {
      for (const serial of previouslyAttached.keys()) usb.detachUsb(serial)
      previouslyAttached.clear()
    }).finally(() => { attaching = null })
    return attaching
  }
  void attachUsbDevices()
  const attachInterval = setInterval(() => { void attachUsbDevices() }, 3500)
  attachInterval.unref?.()
  const mainWindow = windows.createMainWindow(rendererTarget)
  pcRemote = new PcRemoteDesktop(path.join(path.dirname(preloadPath), 'remote', 'pc-capture-preload.cjs'),
    mainWindow, input, () => windows.showMain(),
    device => credentials.list().some(item => item.id === device.id && item.pairedAt === device.pairedAt))
  const scrcpyPresentation = new ScrcpyPresentation(mainWindow, scrcpy)
  void windows.configureTray(() => windows.quit())
  let showingPairing = false
  notifyPhoneRequest = () => {
    if (showingPairing || mainWindow.isDestroyed()) return
    const prompt = usb.approval.desktopPrompts()[0]
    if (!prompt) return
    showingPairing = true
    windows.showMain()
    const signal = AbortSignal.timeout(Math.max(1, prompt.expiresAt - Date.now()))
    void dialog.showMessageBox(mainWindow, {
      type: 'question', title: 'Telefonu eşleştir', message: `${prompt.name} Eon’a bağlanmak istiyor.`,
      buttons: ['Reddet', 'Kabul et'], defaultId: 0, cancelId: 0, noLink: true, signal,
    }).then(async ({ response }) => {
      await attachUsbDevices()
      usb.approval.decideDesktop(prompt.id, response === 1)
    }).catch(() => { /* A disconnected or expired request cannot be approved. */ }).finally(() => {
      showingPairing = false
      notifyPhoneRequest?.()
    })
  }
  const contents = mainWindow.webContents
  ai = new EonAiService({
    dataDir: storage,
    actions,
    deckLayout,
    secureStorage: safeStorage,
    navigate: section => { if (!contents.isDestroyed()) contents.send('eon2:ai:navigate', section) },
    listApplications: refresh => windows.listPrograms(refresh),
    inspectApplication: application => inspectWindowsApplication(application.path),
    createDesktopShortcut: (application, name) => createWindowsShortcut(app.getPath('desktop'), application.path, name),
    launchApplication: target => windows.launchProgram(target),
    pcStatus: () => {
      const { cpu, memory, disk, uptimeSeconds } = telemetry.snapshot()
      return { cpu, memory, disk, uptimeSeconds }
    },
    mediaKey: key => {
      if (process.platform !== 'win32' || !input.mediaKey(key)) throw new Error('Windows medya tuşunu kabul etmedi.')
    },
    createNote: note => notes.save(note),
    setTheme: async theme => { await updateSettings({ key: 'theme', value: theme }, false) },
  })
  const stopScrcpyEvents = scrcpy.subscribe(status => {
    if (!contents.isDestroyed()) contents.send('eon2:scrcpy:changed', status)
  })
  contents.on('did-start-navigation', (_event, _url, inPlace, mainFrame) => {
    if (mainFrame && !inPlace) {
      scrcpyPresentation.layout(null)
      pcRemote?.stop('Eon penceresi yeniden yüklendi.')
    }
  })
  contents.on('render-process-gone', () => { scrcpy.stop(); pcRemote?.stop('Eon penceresi kapandı.') })
  // A top-level redirect to an untrusted page must never inherit the privileged
  // preload, even though IPC handlers already check the sender instance.
  const rendererEntry = new URL(rendererTarget)
  const isTrustedNavigation = (url: string): boolean => {
    try {
      const candidate = new URL(url)
      if (rendererEntry.protocol === 'file:') return candidate.href === rendererEntry.href
      return candidate.protocol === 'http:' && candidate.origin === rendererEntry.origin && candidate.hostname === '127.0.0.1'
    } catch { return false }
  }
  contents.on('will-navigate', (event, url) => {
    if (!isTrustedNavigation(url)) event.preventDefault()
  })
  contents.setWindowOpenHandler(() => ({ action: 'deny' }))

  const handle = (channel: string, callback: (payload: unknown) => unknown | Promise<unknown>) => {
    ipcMain.handle(channel, async (event: IpcMainInvokeEvent, payload: unknown) => {
      if (event.sender !== contents || event.sender.isDestroyed() || event.senderFrame !== contents.mainFrame ||
          !isTrustedNavigation(contents.getURL())) throw new Error('Güvenilmeyen uygulama renderer çağrısı.')
      return callback(payload)
    })
  }

  handle('window:minimize', () => windows.minimize())
  handle('window:toggle-maximize', () => windows.toggleMaximize())
  handle('window:is-maximized', () => windows.isMaximized())
  handle('window:close', () => windows.close())
  handle('window:show', () => windows.showMain())
  handle('eon2:system-snapshot', () => telemetry.snapshot())
  handle('eon2:deck:get', () => {
    // Local desktop controls are available independently of phone-specific grants.
    const deck = describeDeck(actions.list(),
      ['actions.execute', 'power.manage'], process.platform === 'win32', power.getTimerStatus(), true)
    return { ...deck, ...deckTelemetry.snapshot(true) }
  })
  handle('eon2:deck:layout:get', () => deckLayout.get())
  handle('eon2:deck:layout:set', payload => {
    try { return deckLayout.set(payload) }
    catch (error) {
      if (error instanceof DeckLayoutConflictError) return { error: 'deck-layout-conflict', layout: error.layout }
      throw error
    }
  })
  handle('eon2:deck:execute', async payload => {
    if (process.platform !== 'win32') throw new Error('Bu işlem Windows gerektirir.')
    const command = parseDeckCommand(payload)
    if (command.type === 'media') {
      if (!input.mediaKey(command.id)) throw new Error('Windows medya tuşunu kabul etmedi.')
    } else if (command.id === 'settings') {
      await shell.openExternal('ms-settings:')
    } else {
      const executable = command.id === 'explorer' ? path.join(windowsDirectory, 'explorer.exe')
        : path.join(systemDirectory, command.id === 'terminal' ? 'cmd.exe' : 'Taskmgr.exe')
      await new Promise<void>((resolve, reject) => {
        const child = spawn(executable, [], { detached: true, stdio: 'ignore', shell: false })
        child.once('error', reject)
        child.once('spawn', () => { child.unref(); resolve() })
      })
    }
    return { ok: true }
  })
  handle('eon2:settings:get', () => settingsSnapshot())
  handle('eon2:settings:set', payload => updateSettings(payload, true))
  handle('eon2:settings:export', async () => {
    const result = await dialog.showSaveDialog({ title: 'Eon ayarlarını dışa aktar', defaultPath: 'eon-ayarlar.json', filters: [{ name: 'Eon ayarları', extensions: ['json'] }] })
    if (result.canceled || !result.filePath) return false
    fs.writeFileSync(result.filePath, JSON.stringify({ version: 1, settings: settingsSnapshot() }, null, 2), { encoding: 'utf8', mode: 0o600 })
    return true
  })
  handle('eon2:settings:import', async () => {
    const result = await dialog.showOpenDialog({ title: 'Eon ayarlarını içe aktar', properties: ['openFile'], filters: [{ name: 'Eon ayarları', extensions: ['json'] }] })
    if (result.canceled || !result.filePaths[0]) return null
    const file = result.filePaths[0]
    if (fs.statSync(file).size > 65536) throw new Error('Ayar dosyası çok büyük.')
    const data: unknown = JSON.parse(fs.readFileSync(file, 'utf8'))
    if (!data || typeof data !== 'object' || Array.isArray(data)) throw new Error('Geçersiz ayar dosyası.')
    const backup = data as { version?: unknown; settings?: unknown }
    if (backup.version !== 1 || !backup.settings || typeof backup.settings !== 'object' || Array.isArray(backup.settings)) throw new Error('Desteklenmeyen ayar dosyası.')
    const saved = backup.settings as Record<string, unknown>
    if ((saved.theme !== null && (typeof saved.theme !== 'string' || !isAppTheme(saved.theme))) || typeof saved.tailscale !== 'boolean' || typeof saved.autostart !== 'boolean') throw new Error('Ayar dosyasının içeriği geçersiz.')
    if (saved.theme !== null) await updateSettings({ key: 'theme', value: saved.theme }, true)
    if (process.platform === 'win32') await updateSettings({ key: 'autostart', value: saved.autostart }, true)
    await updateSettings({ key: 'tailscale', value: saved.tailscale }, true)
    return settingsSnapshot()
  })
  handle('eon2:theme:set', payload => {
    if (payload !== 'dark' && payload !== 'light') throw new Error('Geçersiz tema.')
    windows.setTheme(payload)
    return true
  })
  handle('eon2:actions:list', () => ({ actions: actions.list(), timer: power.getTimerStatus() }))
  handle('eon2:actions:save', payload => actions.save(payload))
  handle('eon2:actions:delete', payload => actions.remove(readTextField(payload, 'id', 90)))
  handle('eon2:actions:execute', payload => actions.execute(readTextField(payload, 'id', 90)))
  handle('eon2:ai:state', () => ai!.state())
  handle('eon2:ai:configure', payload => ai!.configure(payload))
  handle('eon2:ai:connect', async () => {
    if (!safeStorage.isEncryptionAvailable() || safeStorage.getSelectedStorageBackend?.() === 'basic_text') {
      throw new Error('OpenRouter bağlantısı için işletim sisteminin şifreli anahtar kasası gerekiyor.')
    }
    return ai!.configure({ apiKey: await connectOpenRouter(url => shell.openExternal(url)) })
  })
  handle('eon2:ai:models', () => ai!.models())
  handle('eon2:ai:send', payload => ai!.send(payload))
  handle('eon2:ai:pending', () => ai!.pending())
  handle('eon2:ai:approve', payload => ai!.approve(readTextField(payload, 'id', 90)))
  handle('eon2:ai:reject', payload => ({ ok: ai!.reject(readTextField(payload, 'id', 90)) }))
  handle('eon2:files:list', () => transfers.list())
  handle('eon2:files:directory', () => transfers.getDirectory())
  handle('eon2:files:choose-directory', async () => {
    const selected = await dialog.showOpenDialog(mainWindow, { title: 'Gelen dosyaların kaydedileceği klasör', defaultPath: transfers.getDirectory(), properties: ['openDirectory', 'createDirectory'] })
    return selected.canceled ? transfers.getDirectory() : transfers.setDirectory(selected.filePaths[0])
  })
  handle('eon2:files:open-directory', async () => {
    await fs.promises.mkdir(transfers.getDirectory(), { recursive: true })
    const error = await shell.openPath(transfers.getDirectory())
    if (error) throw new Error(error)
  })
  handle('eon2:files:open', async payload => {
    const error = await shell.openPath(transfers.completedPath(readTextField(payload, 'id', 90)))
    if (error) throw new Error(error)
  })
  handle('eon2:files:save-as', async payload => {
    const source = transfers.completedPath(readTextField(payload, 'id', 90))
    const file = transfers.list().find(file => file.id === readTextField(payload, 'id', 90))!
    const selected = await dialog.showSaveDialog(mainWindow, { title: 'Farklı kaydet', defaultPath: path.join(transfers.getDirectory(), file.fileName) })
    if (!selected.canceled && selected.filePath && path.resolve(selected.filePath).toLowerCase() !== path.resolve(source).toLowerCase()) await fs.promises.copyFile(source, selected.filePath)
  })
  handle('eon2:files:cancel', payload => transfers.cancel(readTextField(payload, 'id', 90)))
  handle('eon2:files:offer', async payload => {
    const deviceId = readTextField(payload, 'deviceId', 90)
    if (!credentials.list().some(device => device.id === deviceId && device.permissions.includes('files.transfer'))) throw new Error('Bu cihaz için dosya aktarımını etkinleştir.')
    const selected = await dialog.showOpenDialog(mainWindow, { title: 'Telefona gönderilecek dosyalar', properties: ['openFile', 'multiSelections'] })
    return selected.canceled ? transfers.list() : transfers.offer(selected.filePaths, deviceId)
  })
  handle('eon2:files:drop', async payload => {
    const deviceId = readTextField(payload, 'deviceId', 90)
    if (!credentials.list().some(device => device.id === deviceId && device.permissions.includes('files.transfer'))) throw new Error('Bu cihaz için dosya aktarımını etkinleştir.')
    return transfers.offer(readDroppedPaths(payload), deviceId)
  })
  handle('eon2:actions:drop', async payload => {
    const paths = readDroppedPaths(payload)
    if (paths.length !== 1) throw new Error('Kısayol için bir dosya bırak.')
    const target = paths[0]
    const stat = await fs.promises.stat(target)
    if (!stat.isFile()) throw new Error('Kısayol için yerel bir dosya bırak.')
    const extension = path.extname(target)
    // Keep .lnk files intact: Windows preserves their arguments and working directory.
    const shortcutApp = extension.toLowerCase() === '.lnk' && /\.exe$/i.test(shell.readShortcutLink(target).target)
    return { name: path.basename(target, extension).slice(0, 80), target,
      kind: extension.toLowerCase() === '.exe' || shortcutApp ? 'application' : 'file' }
  })
  handle('eon2:actions:pick-app', async () => {
    const selected = await dialog.showOpenDialog(mainWindow, { properties: ['openFile'], filters: [{ name: 'Windows uygulaması', extensions: ['exe', 'lnk'] }] })
    return selected.canceled ? null : selected.filePaths[0]
  })
  handle('eon2:permissions:set', payload => {
    const id = readTextField(payload, 'id', 90)
    const permission = readTextField(payload, 'permission', 30)
    const enabled = (payload as { enabled?: unknown }).enabled
    if ((permission !== 'files.transfer' && permission !== 'actions.execute' && permission !== 'power.manage') || typeof enabled !== 'boolean') throw new Error('Geçersiz izin.')
    return credentials.setPermission(id, permission, enabled)
  })
  handle('eon2:devices', async () => {
    const devices = await adb.list()
    return { devices, scannedAt: Date.now(), transport: 'usb' as const, serverReady: usbReady, tunnelledSerials: [...previouslyAttached.keys()] }
  })
  handle('eon2:paired-devices', () => usb.listDevices())
  handle('eon2:mobile:status', async payload => ({
    installed: await adb.companionInstalled(readTextField(payload, 'serial', 160)),
    available: fs.existsSync(companionApk),
  }))
  handle('eon2:mobile:install', async payload => {
    await adb.installCompanion(readTextField(payload, 'serial', 160), companionApk)
    return { installed: true }
  })
  handle('eon2:mobile:install-apk', async payload => {
    const serial = readTextField(payload, 'serial', 160)
    await adb.requireUsbDevice(serial)
    const selected = await dialog.showOpenDialog(mainWindow, {
      title: 'Kurulacak Android APK dosyasını seç',
      properties: ['openFile'],
      filters: [{ name: 'Android APK', extensions: ['apk'] }],
    })
    const [apkPath] = selected.filePaths
    if (selected.canceled || !apkPath) return null
    await adb.installApk(serial, apkPath)
    return path.basename(apkPath)
  })
  handle('eon2:tailnet:get', () => tailnetSnapshot())
  handle('eon2:tailnet:refresh', () => refreshTailnet())
  handle('eon2:tailnet:set', async (payload) => {
    if (!payload || typeof payload !== 'object' || Array.isArray(payload) || typeof (payload as { enabled?: unknown }).enabled !== 'boolean') {
      throw new Error('Geçersiz Tailscale ayarı.')
    }
    persistTailnetSetting((payload as { enabled: boolean }).enabled)
    return applyTailnetSetting()
  })
  function persistTailnetSetting(enabled: boolean) {
    const temporary = `${tailnetSettingsPath}.${randomUUID()}.tmp`
    fs.mkdirSync(storage, { recursive: true })
    try {
      fs.writeFileSync(temporary, JSON.stringify({ version: 1, enabled }), { flag: 'wx', mode: 0o600 })
      fs.renameSync(temporary, tailnetSettingsPath)
    } finally { try { fs.unlinkSync(temporary) } catch { /* renamed */ } }
    tailnetEnabled = enabled
  }
  async function applyTailnetSetting() {
    if (!tailnetEnabled) await usb.stopTailnet()
    return refreshTailnet()
  }
  handle('eon2:scrcpy:status', () => scrcpy.getStatus())
  handle('eon2:scrcpy:stop', () => scrcpy.stop())
  handle('eon2:scrcpy:mode', payload => scrcpyPresentation.setMode(payload))
  handle('eon2:scrcpy:layout', payload => scrcpyPresentation.layout(payload))
  handle('eon2:scrcpy:start', async (payload) => {
    if (!payload || typeof payload !== 'object' || Array.isArray(payload)) throw new Error('Geçersiz scrcpy isteği.')
    const source = payload as Record<string, unknown>
    const serial = readTextField(payload, 'serial', 160)
    const options: ScrcpyOptions = {}
    for (const field of ['maxFps', 'maxSize', 'bitRateMbps', 'windowWidth', 'windowHeight'] as const) {
      if (source[field] !== undefined) {
        if (typeof source[field] !== 'number') throw new Error('Geçersiz scrcpy görüntü ayarı.')
        options[field] = source[field]
      }
    }
    for (const field of ['showTouches', 'turnScreenOff'] as const) {
      if (source[field] !== undefined) {
        if (typeof source[field] !== 'boolean') throw new Error('Geçersiz scrcpy kontrol ayarı.')
        options[field] = source[field]
      }
    }
    return scrcpy.start(serial, options)
  })
  handle('eon2:pairing:begin', async (payload) => {
    if (!usbReady) throw new Error('Eon USB sunucusu hazır değil (127.0.0.1:8768).')
    const serial = readTextField(payload, 'serial', 160)
    const target = (await adb.list(true)).find(device => device.serial === serial && device.usb && device.state === 'device')
    if (!target) throw new Error('Cihaz ADB üzerinden yetkili ve kabloyla bağlı değil.')
    await attachUsbDevices()
    if (!previouslyAttached.has(serial)) throw new Error('USB bağlantısı hazırlanıyor. Birkaç saniye sonra yeniden dene.')
    const prompt = usb.approval.startDesktop(serial, target.model?.replace(/_/g, ' ') || 'Android')
    try { await adb.openCompanion(serial) }
    catch (error) { usb.approval.disconnect(serial); throw error }
    return prompt
  })
  handle('eon2:pairing:state', payload => usb.approval.desktopState(readTextField(payload, 'id', 90)))
  handle('eon2:pairing:cancel', () => { usb.cancelPairing(); return true })
  handle('eon2:pairing:revoke', payload => {
    const id = readTextField(payload, 'id', 90)
    const revoked = usb.revoke(id)
    if (revoked) pcRemote?.revokeDevice(id)
    return revoked
  })
  handle('eon2:notes:list', () => notes.list())
  handle('eon2:notes:conflicts', () => notes.getConflicts())
  handle('eon2:notes:manifest', () => notes.getManifest())
  handle('eon2:notes:identity', () => notes.identity())
  handle('eon2:notes:resolve', (payload) => {
    if (!payload || typeof payload !== 'object' || Array.isArray(payload)) throw new Error('Geçersiz çözüm verisi.')
    const input = payload as Record<string, unknown>
    const noteId = readTextField(payload, 'noteId', 128)
    if (!Array.isArray(input.expectedHeads) || input.expectedHeads.length < 1 || input.expectedHeads.length > 10 ||
        !input.expectedHeads.every((head) => typeof head === 'string' && /^[a-f0-9]{64}$/.test(head))) throw new Error('Geçersiz çakışma sürümleri.')
    if (!input.resolution || typeof input.resolution !== 'object' || Array.isArray(input.resolution)) throw new Error('Geçersiz çözüm.')
    const resolution = input.resolution as Record<string, unknown>
    if (resolution.deleted === true) return notes.resolveConflict(noteId, input.expectedHeads as string[], { deleted: true })
    if (typeof resolution.title !== 'string' || typeof resolution.content !== 'string') throw new Error('Geçersiz not çözüm metni.')
    if (resolution.title.length > 256 || resolution.content.length > 5 * 1024 * 1024) throw new Error('Çözüm içeriği fazla büyük.')
    const metadata = resolution.metadata
    if (metadata !== undefined && (!metadata || typeof metadata !== 'object' || Array.isArray(metadata) || JSON.stringify(metadata).length > 65536)) {
      throw new Error('Çözüm metadata verisi geçersiz veya fazla büyük.')
    }
    return notes.resolveConflict(noteId, input.expectedHeads as string[], { title: resolution.title, content: resolution.content,
      ...(metadata === undefined ? {} : { metadata: metadata as Record<string, string> }) })
  })
  handle('eon2:notes:history', (payload) => notes.history(readTextField(payload, 'id', 60)))
  handle('eon2:notes:save', (payload) => notes.save(readNoteSave(payload)))
  handle('eon2:notes:delete', (payload) => {
    const id = readTextField(payload, 'id', 60)
    const expectedRevisionId = readTextField(payload, 'expectedRevisionId', 64)
    return notes.delete(id, expectedRevisionId)
  })

  mainWindow.webContents.once('did-finish-load', () => windows.finishSplash())
  mainWindow.on('closed', () => app.quit())
  return {
    windows,
    close() {
      closing = true
      clearInterval(attachInterval)
      clearInterval(tailnetInterval)
      scrcpy.dispose()
      pcRemote?.dispose()
      stopScrcpyEvents()
      scrcpyPresentation.dispose()
      void transfers.close().catch(() => console.warn('[eon2] incomplete transfer cleanup failed'))
      if (usbReady) void usb.stop().catch(() => undefined)
      for (const channel of ['window:minimize', 'window:toggle-maximize', 'window:is-maximized', 'window:close', 'window:show',
        'eon2:theme:set', 'eon2:settings:get', 'eon2:settings:set', 'eon2:settings:import', 'eon2:settings:export', 'eon2:files:drop', 'eon2:actions:drop', 'eon2:pairing:state',
        'eon2:actions:list', 'eon2:actions:save', 'eon2:actions:delete', 'eon2:actions:execute', 'eon2:actions:pick-app',
        'eon2:ai:state', 'eon2:ai:configure', 'eon2:ai:connect', 'eon2:ai:models', 'eon2:ai:send',
        'eon2:ai:pending', 'eon2:ai:approve', 'eon2:ai:reject',
        'eon2:files:list', 'eon2:files:offer', 'eon2:files:cancel', 'eon2:permissions:set',
        'eon2:files:directory', 'eon2:files:choose-directory', 'eon2:files:open-directory', 'eon2:files:open', 'eon2:files:save-as',
        'eon2:system-snapshot', 'eon2:deck:get', 'eon2:deck:layout:get', 'eon2:deck:layout:set', 'eon2:deck:execute', 'eon2:devices', 'eon2:paired-devices', 'eon2:pairing:begin', 'eon2:pairing:cancel', 'eon2:pairing:revoke',
        'eon2:mobile:status', 'eon2:mobile:install', 'eon2:mobile:install-apk',
        'eon2:scrcpy:status', 'eon2:scrcpy:stop', 'eon2:scrcpy:start', 'eon2:scrcpy:mode', 'eon2:scrcpy:layout',
        'eon2:tailnet:get', 'eon2:tailnet:refresh', 'eon2:tailnet:set',
        'eon2:notes:list', 'eon2:notes:history', 'eon2:notes:save', 'eon2:notes:delete']) {
        // See additional explicit Eon 2 Note API endpoints below.
        ipcMain.removeHandler(channel)
      }
      for (const channel of ['eon2:notes:conflicts', 'eon2:notes:manifest', 'eon2:notes:identity', 'eon2:notes:resolve']) ipcMain.removeHandler(channel)
      notes.close()
    },
  }
}

function readDroppedPaths(payload: unknown): string[] {
  const paths = (payload as { paths?: unknown } | null)?.paths
  if (!Array.isArray(paths) || paths.length < 1 || paths.length > 20 || !paths.every(value =>
    typeof value === 'string' && value.length <= 4096 && /^[A-Za-z]:[\\/]/.test(value) && !value.includes('\0'))) {
    throw new Error('Windows Gezgini’nden en fazla 20 yerel dosya bırak.')
  }
  return [...new Set<string>(paths)]
}

function readTextField(payload: unknown, key: string, maxLength: number): string {
  const source = payload && typeof payload === 'object' && !Array.isArray(payload) ? payload as Record<string, unknown> : null
  const value = source?.[key]
  if (typeof value !== 'string' || !value.trim() || value.length > maxLength) throw new Error(`Geçersiz alan: ${key}`)
  return value
}

function readNoteSave(payload: unknown): NoteSaveInput {
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) throw new Error('Geçersiz not isteği.')
  const source = payload as Record<string, unknown>
  if (typeof source.title !== 'string' || typeof source.content !== 'string') throw new Error('Not başlığı veya içeriği geçersiz.')
  return {
    title: source.title,
    content: source.content,
    ...(source.id === undefined ? {} : { id: readTextField(payload, 'id', 60) }),
    ...(source.expectedRevisionId === undefined ? {} : { expectedRevisionId: readTextField(payload, 'expectedRevisionId', 64) }),
    ...(source.path === undefined ? {} : { path: readTextField(payload, 'path', 240) }),
  }
}

