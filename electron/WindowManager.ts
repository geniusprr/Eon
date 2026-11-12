import {
  app,
  BrowserWindow,
  dialog,
  Menu,
  nativeImage,
  net,
  shell,
  Tray,
  type BrowserWindowConstructorOptions,
} from 'electron'
import { execFile } from 'node:child_process'
import { readdir } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { promisify } from 'node:util'
import { APP_EVENTS, type AppUpdateStatus, type ProgramCandidate } from '../shared/contracts.js'

const execFileAsync = promisify(execFile)
const PROGRAM_EXTENSIONS = new Set(['.exe', '.com', '.lnk'])
const PROGRAM_INDEX_TTL_MS = 15 * 60 * 1_000
const PROGRAM_INDEX_LIMIT = 400
const WEBSITE_ICON_FETCH_TIMEOUT_MS = 8_000
const WEBSITE_ICON_MAX_BYTES = 512 * 1024
const PNG_SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])

function isHttpUrl(value: string) {
  try {
    const url = new URL(value.trim())
    return (url.protocol === 'http:' || url.protocol === 'https:') && !/[\s\u0000-\u001f]/.test(value)
  } catch {
    return false
  }
}

export class WindowManager {
  private mainWindow: BrowserWindow | null = null
  private splashWindow: BrowserWindow | null = null
  private splashTimer: NodeJS.Timeout | null = null
  private splashStatus: AppUpdateStatus | null = null
  private tray: Tray | null = null
  private allowClose = false
  private browserFocusMode = false
  private rendererUrl: string | null = null
  private programIndex: { createdAt: number; items: ProgramCandidate[] } | null = null
  private programIconCache = new Map<string, string | null>()
  private websiteIconCache = new Map<string, string | null>()
  private readonly preloadPath: string

  constructor(preloadPath: string) {
    this.preloadPath = preloadPath
  }

  createMainWindow(rendererUrl: string) {
    this.rendererUrl = rendererUrl
    // The renderer owns the landscape wallpaper. Keep the native window fully
    // opaque so neither Acrylic nor the desktop can show through it.
    const options: BrowserWindowConstructorOptions = {
      width: 1440,
      height: 900,
      minWidth: 720,
      minHeight: 520,
      title: 'Eon',
      show: false,
      // Use the operating system's real caption buttons. The titlebar is
      // hidden into the client area so the wallpaper remains visible behind
      // the controls instead of introducing a second renderer chrome layer.
      frame: true,
      titleBarStyle: 'hidden',
      titleBarOverlay: {
        color: '#00000000',
        symbolColor: '#263448',
        height: 38,
      },
      transparent: false,
      roundedCorners: true,
      // Keep native resize and rounded-corner behavior available on Windows.
      thickFrame: true,
      backgroundColor: '#0b1324',
      center: true,
      webPreferences: {
        preload: this.preloadPath,
        nodeIntegration: false,
        contextIsolation: true,
        sandbox: true,
        webviewTag: false,
        spellcheck: true,
      },
    }
    const window = new BrowserWindow(options)
    this.mainWindow = window
    // Normal launches open maximized. The smoke runner intentionally keeps a
    // deterministic restored window so its fixed WebContentsView bounds remain
    // meaningful and independent of the developer display.
    if (process.env.KAPANIS_SMOKE_TEST !== '1' && !app.commandLine.hasSwitch('background') && !window.isMaximized()) window.maximize()
    window.webContents.on('before-input-event', (event, input) => {
      if (input.type !== 'keyDown' || input.key !== 'F11' || input.control || input.alt || input.meta || input.shift) return
      // Electron's default application menu also owns F11 on Windows. Consume
      // it before the menu can toggle native fullscreen on non-browser pages,
      // then let the renderer decide whether the browser workspace is active.
      event.preventDefault()
      if (!window.webContents.isDestroyed()) window.webContents.send(APP_EVENTS.browserFocusShortcut)
    })
    window.on('closed', () => {
      this.browserFocusMode = false
      this.mainWindow = null
    })
    window.on('leave-full-screen', () => {
      if (!this.browserFocusMode) return
      this.browserFocusMode = false
      this.broadcastBrowserFocusMode()
    })
    window.webContents.on('did-finish-load', () => {
      if (!this.splashWindow && !app.commandLine.hasSwitch('background')) window.showInactive()
    })
    window.webContents.on('did-fail-load', (_event, errorCode, description, validatedURL, isMainFrame) => {
      if (isMainFrame) console.error('[window] renderer did-fail-load', { errorCode, description, validatedURL })
    })
    window.webContents.on('render-process-gone', (_event, details) => {
      console.error('[window] renderer process gone', details)
    })
    void window.loadURL(rendererUrl).catch((error) => {
      console.error('[window] renderer could not load', error)
    })
    return window
  }

  createSplash(rendererUrl: string) {
    if (app.commandLine.hasSwitch('background')) return
    if (this.splashTimer) clearTimeout(this.splashTimer)
    this.splashWindow = new BrowserWindow({
      width: 430,
      height: 238,
      title: 'Eon',
      show: false,
      frame: false,
      transparent: false,
      backgroundColor: '#0b1324',
      resizable: false,
      maximizable: false,
      minimizable: false,
      closable: false,
      skipTaskbar: true,
      alwaysOnTop: true,
      center: true,
      webPreferences: {
        preload: this.preloadPath,
        nodeIntegration: false,
        contextIsolation: true,
        sandbox: true,
      },
    })
    const splash = this.splashWindow
    const showSplash = () => {
      if (!splash.isDestroyed() && !splash.isVisible()) splash.show()
    }
    splash.once('ready-to-show', showSplash)
    splash.webContents.once('did-finish-load', () => {
      showSplash()
      this.flushSplashStatus()
    })
    splash.on('closed', () => {
      if (this.splashWindow === splash) this.splashWindow = null
    })
    const splashTarget = rendererUrl.startsWith('file:')
      ? pathToSplashFile(rendererUrl)
      : `${rendererUrl.replace(/\/$/, '')}/splash.html`
    if (splashTarget.startsWith('http:') || splashTarget.startsWith('https:')) {
      void splash.loadURL(splashTarget).catch(() => undefined)
    } else {
      void splash.loadFile(splashTarget).catch(() => undefined)
    }
    this.splashTimer = setTimeout(() => this.finishSplash(), 8_000)
    this.splashTimer.unref?.()
  }

  finishSplash() {
    if (this.splashTimer) {
      clearTimeout(this.splashTimer)
      this.splashTimer = null
    }
    if (this.mainWindow && !this.mainWindow.isDestroyed()) {
      if (!app.commandLine.hasSwitch('background')) this.mainWindow.show()
    }
    const splash = this.splashWindow
    this.splashWindow = null
    if (splash && !splash.isDestroyed()) {
      try { splash.hide() } catch { /* best effort */ }
      // The splash is a non-interactive startup surface. destroy() avoids the
      // native close-to-tray handler and guarantees the window cannot linger.
      try { splash.destroy() } catch { /* best effort */ }
    }
  }

  setSplashStatus(status: AppUpdateStatus) {
    this.splashStatus = status
    this.flushSplashStatus()
  }

  private flushSplashStatus() {
    const splash = this.splashWindow
    if (!splash || splash.isDestroyed() || splash.webContents.isDestroyed() || !this.splashStatus) return
    splash.webContents.send(APP_EVENTS.updateStatus, this.splashStatus)
  }

  getMainWindow() {
    return this.mainWindow && !this.mainWindow.isDestroyed() ? this.mainWindow : null
  }

  showMain() {
    const window = this.getMainWindow()
    if (!window) return
    if (window.isMinimized()) window.restore()
    if (!window.isVisible()) window.show()
    window.focus()
  }

  hideToTray() {
    this.getMainWindow()?.hide()
  }

  minimize() {
    this.getMainWindow()?.minimize()
  }

  toggleMaximize() {
    const window = this.getMainWindow()
    if (!window) return
    if (window.isMaximized()) window.unmaximize()
    else window.maximize()
  }

  isMaximized() {
    return this.getMainWindow()?.isMaximized() ?? false
  }

  setTheme(theme: 'light' | 'dark') {
    const window = this.getMainWindow()
    if (!window) return
    window.setTitleBarOverlay({
      color: '#00000000',
      symbolColor: theme === 'dark' ? '#ffffff' : '#263448',
      height: 38,
    })
  }

  close() {
    const window = this.getMainWindow()
    if (!window) return
    // Let the native close button and the renderer fallback share one real
    // close path. main.ts owns the asynchronous cleanup in before-quit.
    this.allowClose = true
    window.close()
  }

  quit() {
    this.allowClose = true
    app.quit()
  }

  allowCloseOnQuit() {
    this.allowClose = true
  }

  setFullscreen(fullscreen: boolean) {
    const window = this.getMainWindow()
    if (!window) return
    window.setFullScreen(fullscreen || this.browserFocusMode)
  }

  isFullscreen() {
    return this.getMainWindow()?.isFullScreen() ?? false
  }

  setBrowserFocusMode(enabled: boolean) {
    const window = this.getMainWindow()
    if (!window) return false
    this.browserFocusMode = enabled
    if (window.isFullScreen() !== enabled) window.setFullScreen(enabled)
    this.broadcastBrowserFocusMode()
    return this.browserFocusMode
  }

  toggleBrowserFocusMode() {
    return this.setBrowserFocusMode(!this.browserFocusMode)
  }

  isBrowserFocusMode() {
    return this.browserFocusMode
  }

  private broadcastBrowserFocusMode() {
    const window = this.getMainWindow()
    if (!window || window.webContents.isDestroyed()) return
    window.webContents.send(APP_EVENTS.browserFocusChanged, { enabled: this.browserFocusMode })
  }

  async openExternal(value: string) {
    const url = value.trim()
    if (!isHttpUrl(url)) throw new Error('Yalnızca geçerli http veya https bağlantıları açılabilir.')
    await shell.openExternal(url)
  }

  async launchProgram(value: string) {
    const input = value.trim()
    if (!path.isAbsolute(input)) throw new Error('Program yolu tam dosya yolu olmalı.')
    const resolved = path.resolve(input)
    if (!await fileExists(resolved)) throw new Error('Program dosyası bulunamadı.')
    if (process.platform === 'win32' && !isProgramPath(resolved)) {
      throw new Error('Windows hızlı erişimi .exe, .com veya .lnk dosyalarını destekler.')
    }
    const error = await shell.openPath(resolved)
    if (error) throw new Error(error)
  }

  async listPrograms(refresh = false): Promise<ProgramCandidate[]> {
    if (process.platform !== 'win32') return []

    const now = Date.now()
    if (!refresh && this.programIndex && now - this.programIndex.createdAt < PROGRAM_INDEX_TTL_MS) {
      return this.programIndex.items
    }

    const [startMenuPrograms, appPathPrograms] = await Promise.all([
      listStartMenuPrograms(),
      listAppPathPrograms(),
    ])
    const items = uniquePrograms([...startMenuPrograms, ...appPathPrograms])
    this.programIndex = { createdAt: now, items }
    return items
  }

  async getProgramIcon(value: string): Promise<string | null> {
    if (process.platform !== 'win32') return null

    const input = value.trim()
    if (!path.isAbsolute(input)) return null
    const resolved = path.resolve(input)
    if (!isProgramPath(resolved) || !await fileExists(resolved)) return null

    const cacheKey = path.normalize(resolved).toLowerCase()
    if (this.programIconCache.has(cacheKey)) return this.programIconCache.get(cacheKey) ?? null

    const targets = await programIconTargets(resolved)
    for (const target of targets) {
      try {
        // "large" is still a compact native icon, but avoids the low-detail
        // shell thumbnail that some Windows shortcuts expose at normal size.
        const icon = await app.getFileIcon(target, { size: 'large' })
        if (!icon.isEmpty()) {
          const dataUrl = icon.toDataURL()
          this.programIconCache.set(cacheKey, dataUrl)
          return dataUrl
        }
      } catch {
        // A shortcut can reference an unavailable target; fall back to its own icon.
      }
    }

    this.programIconCache.set(cacheKey, null)
    return null
  }

  async getWebsiteIcon(value: string): Promise<string | null> {
    const url = value.trim()
    if (!isHttpUrl(url)) return null

    const parsed = new URL(url)
    const cacheKey = parsed.origin.toLowerCase()
    if (this.websiteIconCache.has(cacheKey)) return this.websiteIconCache.get(cacheKey) ?? null

    const candidates = [new URL('/favicon.ico', parsed).toString(), ...await discoverWebsiteIconUrls(parsed.toString())]
    for (const candidate of new Set(candidates)) {
      const icon = await fetchWebsiteIcon(candidate)
      if (icon) {
        this.websiteIconCache.set(cacheKey, icon)
        return icon
      }
    }

    this.websiteIconCache.set(cacheKey, null)
    return null
  }

  async pickProgram(): Promise<ProgramCandidate | null> {
    if (process.platform !== 'win32') return null

    const options = {
      title: 'Hızlı erişime program ekle',
      buttonLabel: 'Programı seç',
      properties: ['openFile'] as Array<'openFile'>,
      filters: [{ name: 'Programlar', extensions: ['exe', 'com', 'lnk'] }],
    }
    const window = this.getMainWindow()
    const result = window
      ? await dialog.showOpenDialog(window, options)
      : await dialog.showOpenDialog(options)
    const selectedPath = result.filePaths[0]
    if (result.canceled || !selectedPath) return null

    const resolved = path.resolve(selectedPath)
    if (!isProgramPath(resolved) || !await fileExists(resolved)) {
      throw new Error('Seçilen dosya desteklenen bir Windows programı değil.')
    }

    return {
      name: programLabel(resolved),
      path: resolved,
      source: 'manual',
    }
  }

  async configureTray(onQuit: () => void) {
    if (this.tray) return
    let icon = nativeImage.createEmpty()
    try {
      // Packaged Windows builds inherit the Eon SVG through electron-builder;
      // reading the executable icon keeps the tray perfectly in sync with it.
      if (app.isPackaged && process.platform === 'win32') {
        icon = await app.getFileIcon(process.execPath, { size: 'small' })
      }
    } catch {
      // Fall through to the development/fallback asset below.
    }
    if (icon.isEmpty()) {
      const iconPath = path.join(app.getAppPath(), 'app-icon.png')
      icon = nativeImage.createFromPath(iconPath)
    }
    this.tray = new Tray(icon.isEmpty() ? nativeImage.createEmpty() : icon)
    this.tray.setToolTip('Eon')
    const menu = Menu.buildFromTemplate([
      { label: 'Aç', click: () => this.showMain() },
      { type: 'separator' },
      { label: 'Çık', click: onQuit },
    ])
    this.tray.setContextMenu(menu)
    this.tray.on('click', () => this.showMain())
  }

  setWindowMode(mode: 'notes' | 'compact') {
    const window = this.getMainWindow()
    if (!window) return
    window.setResizable(true)
    window.setMaximizable(true)
    if (mode === 'notes') {
      const [width, height] = window.getContentSize()
      if (width < 1100 || height < 700) window.setSize(1200, 760)
    }
  }
}

async function fileExists(value: string) {
  try {
    const fs = await import('node:fs/promises')
    await fs.access(value)
    return true
  } catch {
    return false
  }
}

function isProgramPath(value: string) {
  return PROGRAM_EXTENSIONS.has(path.extname(value).toLowerCase())
}

async function programIconTargets(value: string) {
  if (path.extname(value).toLowerCase() !== '.lnk') return [value]

  try {
    const shortcut = shell.readShortcutLink(value)
    const target = shortcut.target?.trim()
    const targets: string[] = []

    // MSI "advertised" Start menu shortcuts point at a Windows Installer
    // launcher, whose icon is often just a blank document. The working folder
    // still contains the real executable, so identify the most likely one by
    // the shortcut's label before falling back to the launcher.
    if (target && isWindowsInstallerTarget(target)) {
      const application = await advertisedShortcutApplication(
        shortcut.cwd?.trim(),
        `${programLabel(value)} ${shortcut.description ?? ''}`,
      )
      if (application) targets.push(application)
    }

    if (target && path.isAbsolute(target) && await fileExists(target)) targets.push(target)

    const icon = shortcut.icon?.trim()
    if (icon && path.isAbsolute(icon) && await fileExists(icon)) targets.push(icon)

    return uniqueIconTargets([...targets, value])
  } catch {
    // The shortcut might be stale or protected; its own icon remains a safe fallback.
  }

  return [value]
}

function isWindowsInstallerTarget(value: string) {
  const windowsDirectory = process.env.SystemRoot || 'C:\\Windows'
  const installerDirectory = `${path.resolve(windowsDirectory, 'Installer')}${path.sep}`.toLowerCase()
  return path.resolve(value).toLowerCase().startsWith(installerDirectory)
}

async function advertisedShortcutApplication(workingDirectory: string | undefined, label: string) {
  if (!workingDirectory || !path.isAbsolute(workingDirectory)) return null

  const entries = await readdir(workingDirectory, { withFileTypes: true }).catch(() => [])
  const candidates = entries
    .filter((entry) => entry.isFile() && path.extname(entry.name).toLowerCase() === '.exe')
    .map((entry) => path.join(workingDirectory, entry.name))

  let best: { path: string; score: number } | null = null
  for (const candidate of candidates) {
    const score = programExecutableScore(candidate, label)
    if (!best || score > best.score) best = { path: candidate, score }
  }

  // A modest threshold prevents an unrelated helper executable in the same
  // folder from being presented as the program's icon.
  return best && best.score >= 300 ? best.path : null
}

function programExecutableScore(candidate: string, label: string) {
  const candidateName = normalizedProgramName(path.basename(candidate, path.extname(candidate)))
  if (candidateName.length < 3) return 0

  const candidateConsonants = candidateName.replace(/[aeiou]/g, '')
  const terms = label
    .split(/[\\/._\-\s]+/)
    .map(normalizedProgramName)
    .flatMap((term) => [term, term.replace(/\d+$/g, '')])
    .filter((term, index, values) => term.length >= 3 && values.indexOf(term) === index)

  return terms.reduce((best, term) => {
    if (candidateName === term) return Math.max(best, 1_000)
    if (candidateName.includes(term) || term.includes(candidateName)) return Math.max(best, 700 + Math.min(candidateName.length, term.length))

    const termConsonants = term.replace(/[aeiou]/g, '')
    if (candidateConsonants === termConsonants) return Math.max(best, 600)
    if (candidateConsonants.includes(termConsonants) || termConsonants.includes(candidateConsonants)) {
      return Math.max(best, 400 + Math.min(candidateConsonants.length, termConsonants.length))
    }

    return best
  }, 0)
}

function normalizedProgramName(value: string) {
  return value.toLocaleLowerCase('en-US').replace(/[^a-z0-9]/g, '')
}

function uniqueIconTargets(values: string[]) {
  const seen = new Set<string>()
  return values.filter((value) => {
    const key = path.normalize(value).toLowerCase()
    if (seen.has(key)) return false
    seen.add(key)
    return true
  })
}

async function fetchWebsiteIcon(value: string): Promise<string | null> {
  if (!isHttpUrl(value)) return null

  try {
    const response = await net.fetch(value, {
      headers: { Accept: 'image/avif,image/webp,image/apng,image/svg+xml,image/*,*/*;q=0.8' },
      signal: AbortSignal.timeout(WEBSITE_ICON_FETCH_TIMEOUT_MS),
    })
    if (!response.ok) return null

    const buffer = Buffer.from(await response.arrayBuffer())
    if (buffer.length === 0 || buffer.length > WEBSITE_ICON_MAX_BYTES) return null

    const mimeType = response.headers.get('content-type')?.split(';', 1)[0]?.trim().toLowerCase() || ''
    const detectedMimeType = imageMimeTypeForBuffer(buffer)
    const usableMimeType = mimeType.startsWith('image/') ? mimeType : detectedMimeType
    if (!usableMimeType) return null

    return decodeWebsiteIcon(buffer, usableMimeType)
  } catch {
    return null
  }
}

function imageMimeTypeForBuffer(buffer: Buffer) {
  if (buffer.subarray(0, PNG_SIGNATURE.length).equals(PNG_SIGNATURE)) return 'image/png'
  if (isIcoBuffer(buffer)) return 'image/x-icon'
  if (buffer.length >= 3 && buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff) return 'image/jpeg'
  if (buffer.subarray(0, 6).toString('ascii') === 'GIF87a' || buffer.subarray(0, 6).toString('ascii') === 'GIF89a') return 'image/gif'
  if (buffer.subarray(0, 4).toString('ascii') === 'RIFF' && buffer.subarray(8, 12).toString('ascii') === 'WEBP') return 'image/webp'
  return null
}

function decodeWebsiteIcon(buffer: Buffer, mimeType: string) {
  const image = nativeImage.createFromBuffer(buffer)
  if (!image.isEmpty() && image.getSize().width > 0 && image.getSize().height > 0) return image.toDataURL()

  const embeddedPng = pngFromIco(buffer)
  if (embeddedPng) {
    const pngImage = nativeImage.createFromBuffer(embeddedPng)
    if (!pngImage.isEmpty()) return pngImage.toDataURL()
    return `data:image/png;base64,${embeddedPng.toString('base64')}`
  }

  if (mimeType === 'image/x-icon' || mimeType === 'image/vnd.microsoft.icon') return null
  return `data:${mimeType};base64,${buffer.toString('base64')}`
}

function pngFromIco(buffer: Buffer) {
  if (!isIcoBuffer(buffer)) return null
  const count = buffer.readUInt16LE(4)
  let best: { buffer: Buffer; score: number } | null = null

  for (let index = 0; index < count; index += 1) {
    const entryOffset = 6 + index * 16
    if (entryOffset + 16 > buffer.length) break
    const size = buffer.readUInt32LE(entryOffset + 8)
    const offset = buffer.readUInt32LE(entryOffset + 12)
    if (size === 0 || offset + size > buffer.length) continue

    const candidate = buffer.subarray(offset, offset + size)
    if (!candidate.subarray(0, PNG_SIGNATURE.length).equals(PNG_SIGNATURE)) continue
    const width = buffer[entryOffset] || 256
    const height = buffer[entryOffset + 1] || 256
    const bitDepth = buffer.readUInt16LE(entryOffset + 6)
    const score = width * height * Math.max(bitDepth, 1)
    if (!best || score > best.score) best = { buffer: candidate, score }
  }

  return best?.buffer ?? null
}

function isIcoBuffer(buffer: Buffer) {
  return buffer.length >= 6 && buffer.readUInt16LE(0) === 0 && buffer.readUInt16LE(2) === 1
}

async function discoverWebsiteIconUrls(value: string) {
  try {
    const response = await net.fetch(value, {
      headers: { Accept: 'text/html,application/xhtml+xml;q=0.9,*/*;q=0.1' },
      signal: AbortSignal.timeout(WEBSITE_ICON_FETCH_TIMEOUT_MS),
    })
    if (!response.ok) return []

    const contentType = response.headers.get('content-type')?.toLowerCase() || ''
    if (!contentType.includes('text/html') && !contentType.includes('application/xhtml+xml')) return []

    const html = (await response.text()).slice(0, 256 * 1024)
    const baseUrl = response.url || value
    const candidates: string[] = []
    const manifests: string[] = []
    for (const tag of html.match(/<link\b[^>]*>/gi) || []) {
      const rel = htmlAttribute(tag, 'rel')
      const href = htmlAttribute(tag, 'href')
      if (!rel || !href) continue
      try {
        const candidate = new URL(href, baseUrl).toString()
        if (!isHttpUrl(candidate)) continue
        if (/\b(?:shortcut\s+)?icon\b/i.test(rel)) candidates.push(candidate)
        if (/\bmanifest\b/i.test(rel)) manifests.push(candidate)
      } catch {
        // Ignore malformed icon declarations from the site.
      }
    }
    const manifestIcons = await Promise.all([...new Set(manifests)].map(discoverManifestIconUrls))
    return [...candidates, ...manifestIcons.flat()]
  } catch {
    return []
  }
}

async function discoverManifestIconUrls(value: string) {
  try {
    const response = await net.fetch(value, {
      headers: { Accept: 'application/manifest+json,application/json;q=0.9,*/*;q=0.1' },
      signal: AbortSignal.timeout(WEBSITE_ICON_FETCH_TIMEOUT_MS),
    })
    if (!response.ok) return []

    const manifest = JSON.parse((await response.text()).slice(0, 256 * 1024)) as { icons?: unknown }
    if (!Array.isArray(manifest.icons)) return []

    return manifest.icons
      .map((icon) => typeof icon === 'object' && icon !== null && 'src' in icon ? icon.src : null)
      .filter((src): src is string => typeof src === 'string' && src.trim().length > 0)
      .flatMap((src) => {
        try {
          const candidate = new URL(src, response.url || value).toString()
          return isHttpUrl(candidate) ? [candidate] : []
        } catch {
          return []
        }
      })
  } catch {
    return []
  }
}

function htmlAttribute(tag: string, name: string) {
  const match = tag.match(new RegExp(`\\b${name}\\s*=\\s*(?:"([^"]*)"|'([^']*)'|([^\\s>]+))`, 'i'))
  return match?.[1] ?? match?.[2] ?? match?.[3] ?? null
}

function programLabel(value: string) {
  const name = path.basename(value, path.extname(value)).replace(/[._-]+/g, ' ').trim()
  return name || 'Program'
}

async function listStartMenuPrograms(): Promise<ProgramCandidate[]> {
  const roots = [
    path.join(app.getPath('appData'), 'Microsoft', 'Windows', 'Start Menu', 'Programs'),
    process.env.ProgramData
      ? path.join(process.env.ProgramData, 'Microsoft', 'Windows', 'Start Menu', 'Programs')
      : null,
  ].filter((root): root is string => Boolean(root))

  const candidates: ProgramCandidate[] = []
  for (const root of new Set(roots)) {
    await scanStartMenuDirectory(root, candidates)
    if (candidates.length >= PROGRAM_INDEX_LIMIT) break
  }
  return candidates
}

async function scanStartMenuDirectory(directory: string, candidates: ProgramCandidate[], depth = 0): Promise<void> {
  if (depth > 4 || candidates.length >= PROGRAM_INDEX_LIMIT) return
  const entries = await readdir(directory, { withFileTypes: true }).catch(() => [])

  for (const entry of entries) {
    if (candidates.length >= PROGRAM_INDEX_LIMIT) return
    const entryPath = path.join(directory, entry.name)
    if (entry.isDirectory()) {
      await scanStartMenuDirectory(entryPath, candidates, depth + 1)
      continue
    }
    if (!entry.isFile() || !isProgramPath(entry.name)) continue
    candidates.push({
      name: programLabel(entry.name),
      path: entryPath,
      source: 'start-menu',
    })
  }
}

async function listAppPathPrograms(): Promise<ProgramCandidate[]> {
  const roots = [
    'HKCU\\SOFTWARE\\Microsoft\\Windows\\CurrentVersion\\App Paths',
    'HKLM\\SOFTWARE\\Microsoft\\Windows\\CurrentVersion\\App Paths',
    'HKLM\\SOFTWARE\\WOW6432Node\\Microsoft\\Windows\\CurrentVersion\\App Paths',
  ]
  const outputs = await Promise.all(roots.map(async (root) => {
    try {
      const { stdout } = await execFileAsync('reg.exe', ['query', root, '/s', '/ve'], {
        windowsHide: true,
        timeout: 8_000,
        maxBuffer: 2 * 1024 * 1024,
      })
      return String(stdout)
    } catch {
      return ''
    }
  }))

  const candidates: ProgramCandidate[] = []
  for (const output of outputs) {
    let currentKey = ''
    for (const line of output.split(/\r?\n/)) {
      const trimmed = line.trim()
      if (trimmed.startsWith('HKEY_')) {
        currentKey = trimmed
        continue
      }
      // /ve already limits output to the default value, whose label is localized.
      const match = trimmed.match(/^.+?\s+REG_(?:SZ|EXPAND_SZ)\s+(.+)$/i)
      if (!currentKey || !match) continue
      const candidatePath = extractProgramPath(match[1])
      if (!candidatePath || !isProgramPath(candidatePath) || !await fileExists(candidatePath)) continue
      candidates.push({
        name: programLabel(currentKey || candidatePath),
        path: candidatePath,
        source: 'app-paths',
      })
      if (candidates.length >= PROGRAM_INDEX_LIMIT) return candidates
    }
  }
  return candidates
}

function extractProgramPath(value: string) {
  const trimmed = value.trim()
  const quoted = trimmed.match(/^"([^"\r\n]+\.(?:exe|com|lnk))"/i)
  if (quoted) return quoted[1]
  const unquoted = trimmed.match(/^(.+?\.(?:exe|com|lnk))(?:\s|$)/i)
  return unquoted?.[1]?.trim() || null
}

function uniquePrograms(candidates: ProgramCandidate[]) {
  const seenPaths = new Set<string>()
  return candidates
    .filter((candidate) => {
      const key = path.normalize(candidate.path).toLocaleLowerCase('tr-TR')
      if (seenPaths.has(key)) return false
      seenPaths.add(key)
      return true
    })
    .sort((left, right) => {
      const sourceOrder = programSourceOrder(left.source) - programSourceOrder(right.source)
      return sourceOrder || left.name.localeCompare(right.name, 'tr-TR', { sensitivity: 'base' })
    })
    .slice(0, PROGRAM_INDEX_LIMIT)
}

function programSourceOrder(source: ProgramCandidate['source']) {
  return source === 'start-menu' ? 0 : source === 'app-paths' ? 1 : 2
}

function pathToSplashFile(rendererUrl: string) {
  try {
    const filePath = fileURLToPath(rendererUrl)
    return path.basename(filePath).toLowerCase() === 'splash.html'
      ? filePath
      : path.join(path.dirname(filePath), 'splash.html')
  } catch {
    return rendererUrl
  }
}
