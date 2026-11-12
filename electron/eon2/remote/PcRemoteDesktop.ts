import { BrowserWindow, dialog, powerMonitor, screen, type Display } from 'electron'
import type { ServerResponse } from 'node:http'
import type { PairedDevice } from '../transport/DeviceCredentials.js'
import { WindowsInputInjector } from '../../WindowsInputInjector.js'
import { PcScreenCapture, type VideoPacket } from './PcScreenCapture.js'
import { isWindowsInteractiveDesktop } from './WindowsInteractiveDesktop.js'
import { parseRemoteInput } from './PcRemoteInput.js'

const APPROVAL_MS = 30_000
const JOIN_MS = 10_000
const SESSION_MS = 30 * 60_000
const CLIENT_TIMEOUT_MS = 4500
const MAX_BUFFERED_BYTES = 256 * 1024
const profiles = {
  low: { size: 960, fps: 20, bitrate: 900_000 },
  balanced: { size: 1280, fps: 30, bitrate: 2_400_000 },
  sharp: { size: 1920, fps: 30, bitrate: 5_000_000 },
}

type Session = {
  id: string
  device: PairedDevice
  transport: string
  display: Display
  control: boolean
  phase: 'pending' | 'approved' | 'streaming'
  expiresAt: number
  profile: keyof typeof profiles
  preferAvc: boolean
  approval: AbortController
  stream?: ServerResponse
  indicator?: BrowserWindow
  capture?: PcScreenCapture
  streamStartedAt: number
  lastHeartbeatAt: number
  clientSeenAt: number
  needsKeyFrame: boolean
  lastSequence: number
  inputBudget: number
  budgetAt: number
}

export class PcRemoteDesktop {
  private active: Session | null = null
  private last: { id: string; deviceId: string; transport: string; reason: string } | null = null
  private timer: NodeJS.Timeout | null = null
  private releaseTimer: NodeJS.Timeout | null = null
  private nextPromptAt = 0

  constructor(private readonly preload: string, private readonly window: BrowserWindow,
    private readonly input: WindowsInputInjector, private readonly showMain: () => void,
    private readonly hasIdentity: (device: PairedDevice) => boolean) {
    powerMonitor.on('lock-screen', this.onSecureDesktop)
    powerMonitor.on('suspend', this.onSecureDesktop)
    powerMonitor.on('unlock-screen', this.onUnlock)
    screen.on('display-added', this.onDisplayChange)
    screen.on('display-removed', this.onDisplayChange)
    screen.on('display-metrics-changed', this.onDisplayChange)
  }

  route(operation: string, body: unknown, device: PairedDevice, transport: string, response: ServerResponse) {
    const now = performance.now()
    if (this.active?.phase === 'streaming' && now - this.active.clientSeenAt > CLIENT_TIMEOUT_MS) {
      this.stop('Telefon bağlantısı kesildi.')
    }
    const current = this.active
    const owns = current?.device.id === device.id && current.device.pairedAt === device.pairedAt && current.transport === transport
    const request = body as { id?: unknown; display?: unknown; control?: unknown; quality?: unknown; avc?: unknown; sequence?: unknown; events?: unknown } | null
    if (operation === 'status') {
      if (owns && current.phase === 'streaming') current.clientSeenAt = now
      const primary = screen.getPrimaryDisplay().id
      const last = this.last?.deviceId === device.id && this.last.transport === transport ? this.last : null
      return json(response, 200, {
        supported: process.platform === 'win32',
        displays: screen.getAllDisplays().map((display, index) => ({
          id: display.id, name: display.id === primary ? `Ekran ${index + 1} (ana)` : `Ekran ${index + 1}`,
        })).sort((a, b) => Number(b.id === primary) - Number(a.id === primary)),
        state: owns ? current.phase : current ? 'busy' : 'idle',
        id: owns ? current.id : last?.id,
        reason: owns ? undefined : last?.reason,
      })
    }
    if (typeof request?.id !== 'string' || !/^[a-f0-9-]{36}$/.test(request.id)) {
      return json(response, 400, { error: 'Geçersiz oturum kimliği.' })
    }
    if (operation === 'request') {
      if (current || now < this.nextPromptAt) return json(response, 409, { error: 'PC başka bir paylaşım isteğiyle meşgul.' })
      if (!isWindowsInteractiveDesktop()) return json(response, 409, { error: 'Windows masaüstü şu anda paylaşıma açık değil.' })
      if (!this.releaseHeldInput()) return json(response, 409, { error: 'Windows önceki girişleri bırakana kadar paylaşım açılamıyor.' })
      const display = screen.getAllDisplays().find(item => item.id === request.display)
      const quality = request.quality
      if (!display || (quality !== 'low' && quality !== 'balanced' && quality !== 'sharp') || typeof request.control !== 'boolean') {
        return json(response, 400, { error: 'Ekran veya görüntü ayarı geçersiz.' })
      }
      const pending: Session = {
        id: request.id, device, transport, display, control: request.control, profile: quality, preferAvc: request.avc === true,
        phase: 'pending', expiresAt: now + APPROVAL_MS, approval: new AbortController(),
        streamStartedAt: 0, lastHeartbeatAt: 0, clientSeenAt: now, needsKeyFrame: true, lastSequence: -1, inputBudget: 80, budgetAt: now,
      }
      this.active = pending
      this.last = null
      this.nextPromptAt = now + 2000
      this.timer = setInterval(this.check, 250)
      void this.approve(pending)
      return json(response, 200, { ok: true })
    }
    if (!current || !owns || current.id !== request.id) {
      return json(response, 409, { error: 'Ekran paylaşımı oturumu sona erdi.' })
    }
    if (operation === 'stop') {
      this.stop('Telefon ekran paylaşımını bitirdi.')
      return json(response, 200, { ok: true })
    }
    if (now >= current.expiresAt || !isWindowsInteractiveDesktop()) {
      this.stop('Windows ekran paylaşımını durdurdu.')
      return json(response, 409, { error: 'Ekran paylaşımı oturumu sona erdi.' })
    }
    if (operation === 'stream' && current.phase === 'approved') {
      current.phase = 'streaming'
      current.expiresAt = now + SESSION_MS
      current.streamStartedAt = now
      current.clientSeenAt = now
      current.stream = response
      response.once('close', () => { if (this.active === current) this.stop('Telefon bağlantısı kapandı.') })
      void this.startCapture(current)
      return
    }
    if (operation === 'input' && current.stream?.headersSent && current.control && current.phase === 'streaming') {
      const sequence = request.sequence
      if (typeof sequence !== 'number' || !Number.isSafeInteger(sequence) || sequence <= current.lastSequence) {
        return json(response, 400, { error: 'Geçersiz giriş sırası.' })
      }
      const events = parseRemoteInput(request.events)
      current.inputBudget = Math.min(80, current.inputBudget + Math.max(0, now - current.budgetAt) * 0.12)
      current.budgetAt = now
      if (events.length > current.inputBudget) {
        this.revokeControl(current)
        return json(response, 429, { error: 'Giriş hızı sınırı aşıldı.' })
      }
      current.inputBudget -= events.length
      current.lastSequence = sequence
      try {
        for (const event of events) {
          if (!event(this.input)) throw new Error('Windows giriş komutunu kabul etmedi.')
        }
        return json(response, 200, { ok: true })
      } catch {
        this.revokeControl(current)
        return json(response, 409, { error: 'Windows girişi engelledi. Oturum görüntüleme modunda.' })
      }
    }
    json(response, 409, { error: 'Bu işlem için etkin bir paylaşım izni gerekiyor.' })
  }

  disconnect(transport: string) {
    if (this.active?.transport === transport) this.stop('Bağlantı kesildi.')
  }

  revokeDevice(id: string) {
    if (this.active?.device.id === id) this.stop('Telefonun eşleştirmesi kaldırıldı.')
  }

  stop(reason: string) {
    const current = this.active
    if (!current) return
    this.active = null
    this.last = { id: current.id, deviceId: current.device.id, transport: current.transport, reason }
    if (this.timer) clearInterval(this.timer)
    this.timer = null
    current.approval.abort()
    this.releaseHeldInput()
    current.capture?.close()
    if (current.indicator && !current.indicator.isDestroyed()) current.indicator.destroy()
    const stream = current.stream
    if (stream && !stream.destroyed && !stream.writableEnded) {
      if (stream.writableLength > MAX_BUFFERED_BYTES) stream.destroy()
      else if (stream.headersSent) {
        writePacket(stream, 4, Buffer.from(reason))
        stream.end()
        setTimeout(() => { if (!stream.writableFinished) stream.destroy() }, 1000).unref()
      } else json(stream, 503, { error: reason })
    }
  }

  dispose() {
    this.stop('Eon kapandı.')
    if (this.releaseTimer) clearInterval(this.releaseTimer)
    this.releaseTimer = null
    powerMonitor.off('lock-screen', this.onSecureDesktop)
    powerMonitor.off('suspend', this.onSecureDesktop)
    powerMonitor.off('unlock-screen', this.onUnlock)
    screen.off('display-added', this.onDisplayChange)
    screen.off('display-removed', this.onDisplayChange)
    screen.off('display-metrics-changed', this.onDisplayChange)
  }

  private async approve(current: Session) {
    try {
      this.showMain()
      const { response } = await dialog.showMessageBox(this.window, {
        type: 'question', title: 'Eon · PC ekranı',
        message: `${current.device.name} ekran paylaşımı istiyor.`,
        detail: `Seçilen ekran: ${current.display.label || 'Monitör'} · Süre: en fazla 30 dakika.`,
        buttons: current.control ? ['Reddet', 'Yalnızca görüntü', 'Görüntü ve kontrol'] : ['Reddet', 'Yalnızca görüntü'],
        defaultId: 0, cancelId: 0, noLink: true, signal: current.approval.signal,
      })
      if (this.active !== current) return
      if (response === 0) { this.stop('Paylaşım isteği PC’de reddedildi.'); return }
      if (!this.hasIdentity(current.device) || !isWindowsInteractiveDesktop() || performance.now() >= current.expiresAt) {
        this.stop('Paylaşım isteğinin süresi doldu.'); return
      }
      current.control = current.control && response === 2
      current.phase = 'approved'
      current.expiresAt = performance.now() + JOIN_MS
    } catch {
      if (this.active === current) this.stop('PC paylaşım onayını açamadı.')
    }
  }

  private async startCapture(current: Session) {
    try {
      const display = current.display
      const area = display.workArea
      const width = Math.min(440, area.width)
      const indicator = new BrowserWindow({
        title: 'Eon · PC ekran paylaşımı', width, height: 66, show: false, frame: false, alwaysOnTop: true,
        x: area.x + Math.floor((area.width - width) / 2), y: area.y + 8,
        resizable: false, minimizable: false, maximizable: false, fullscreenable: false, skipTaskbar: true,
        backgroundColor: '#151b25', webPreferences: { sandbox: true, contextIsolation: true, nodeIntegration: false },
      })
      current.indicator = indicator
      indicator.setAlwaysOnTop(true, 'screen-saver')
      indicator.webContents.setWindowOpenHandler(() => ({ action: 'deny' }))
      indicator.webContents.on('will-navigate', (event, url) => {
        event.preventDefault()
        if (this.active !== current) return
        if (url === 'https://eon-indicator.invalid/stop') this.stop('PC ekran paylaşımını bitirdi.')
        if (url === 'https://eon-indicator.invalid/view') this.revokeControl(current)
      })
      indicator.on('closed', () => { if (this.active === current) this.stop('PC ekran paylaşımını bitirdi.') })
      indicator.webContents.on('render-process-gone', () => { if (this.active === current) this.stop('Paylaşım göstergesi kapandı.') })
      await indicator.loadURL(indicatorUrl(current.control))
      if (this.active !== current) return
      indicator.showInactive()
      this.input.setDisplay(screen.dipToScreenRect(null, display.bounds))
      current.capture = new PcScreenCapture(this.preload, packet => this.frame(current, packet), reason => {
        if (this.active === current) this.stop(reason)
      })
      await current.capture.start(display, profiles[current.profile], current.preferAvc)
    } catch (error) {
      if (this.active === current) this.stop(error instanceof Error ? error.message : 'Ekran yakalama başlatılamadı.')
    }
  }

  private frame(current: Session, packet: VideoPacket) {
    const stream = current.stream
    if (this.active !== current || !stream || stream.destroyed) return
    if (!isWindowsInteractiveDesktop()) {
      this.stop('Windows güvenli masaüstüne geçti.')
      return
    }
    if (stream.writableNeedDrain || stream.writableLength > MAX_BUFFERED_BYTES) {
      current.needsKeyFrame = true
      return
    }
    if (current.needsKeyFrame && !packet.key) return
    current.needsKeyFrame = false
    if (!stream.headersSent) {
      stream.socket?.setNoDelay(true)
      stream.writeHead(200, {
        'content-type': `application/vnd.eon.remote-${packet.codec}`, 'cache-control': 'no-store', 'x-content-type-options': 'nosniff',
        'x-eon-width': packet.width, 'x-eon-height': packet.height, 'x-eon-control': current.control ? '1' : '0',
      })
    }
    writePacket(stream, packet.key ? 1 : 2, packet.bytes)
  }

  private revokeControl(current: Session) {
    if (!current.control) return
    current.control = false
    this.releaseHeldInput()
    if (current.stream?.headersSent) {
      if (current.stream.writableLength > MAX_BUFFERED_BYTES) {
        this.stop('Kontrol kapatıldı. Bağlantı yeniden kurulmalı.')
        return
      }
      writePacket(current.stream, 3)
    }
    const indicator = current.indicator
    if (indicator && !indicator.isDestroyed()) {
      void indicator.loadURL(indicatorUrl(false)).catch(() => {
        if (this.active === current) this.stop('Paylaşım göstergesi kapandı.')
      })
    }
  }

  private check = () => {
    const current = this.active
    if (!current) return
    const now = performance.now()
    if (!isWindowsInteractiveDesktop() || !this.hasIdentity(current.device)) {
      this.stop('Windows oturumu veya telefon erişimi değişti.'); return
    }
    if (now >= current.expiresAt) {
      this.stop(current.phase === 'streaming' ? '30 dakikalık paylaşım süresi doldu.' : 'Paylaşım isteğinin süresi doldu.'); return
    }
    if (current.phase !== 'streaming') return
    const stream = current.stream
    if (now - current.clientSeenAt > CLIENT_TIMEOUT_MS || (!stream?.headersSent && now - current.streamStartedAt > 8000) ||
      (stream?.writableNeedDrain && now - current.lastHeartbeatAt > 8000)) {
      this.stop('Ekran akışı kesildi.'); return
    }
    if (stream?.headersSent && !stream.writableNeedDrain && now - current.lastHeartbeatAt >= 1000) {
      writePacket(stream, 0)
      current.lastHeartbeatAt = now
    }
  }

  private onSecureDesktop = () => this.stop('Windows kilitlendi veya uykuya geçti.')
  private onUnlock = () => { this.releaseHeldInput() }
  private onDisplayChange = () => this.stop('Ekran düzeni değişti. Yeniden bağlan.')

  private releaseHeldInput() {
    if (this.input.releaseAll()) {
      if (this.releaseTimer) clearInterval(this.releaseTimer)
      this.releaseTimer = null
      return true
    }
    if (!this.releaseTimer) {
      this.releaseTimer = setInterval(() => {
        if (isWindowsInteractiveDesktop()) this.releaseHeldInput()
      }, 250)
      this.releaseTimer.unref()
    }
    return false
  }
}

function json(response: ServerResponse, status: number, payload: object) {
  if (response.destroyed || response.writableEnded) return
  const body = JSON.stringify(payload)
  response.writeHead(status, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store',
    'content-length': Buffer.byteLength(body), 'x-content-type-options': 'nosniff' })
  response.end(body)
}

function writePacket(stream: ServerResponse, kind: number, bytes?: Uint8Array) {
  const header = Buffer.allocUnsafe(5)
  header.writeUInt32BE(bytes?.length ?? 0)
  header[4] = kind
  stream.cork()
  stream.write(header)
  if (bytes) stream.write(bytes)
  stream.uncork()
}

function indicatorUrl(control: boolean) {
  return 'data:text/html;charset=utf-8,' + encodeURIComponent(`<!doctype html><html lang="tr"><meta charset="utf-8">
    <meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'">
    <style>body{display:flex;align-items:center;justify-content:space-between;gap:8px;margin:0;padding:0 12px;height:66px;
    box-sizing:border-box;background:#151b25;color:#fff;font:600 13px system-ui}div{min-width:0}small{display:block;color:#d4dbe6}
    nav{display:flex;gap:6px}a{padding:9px 8px;border-radius:7px;background:#364256;color:white;text-decoration:none;white-space:nowrap}
    a:last-child{background:#a12b3a}a:focus-visible{outline:2px solid white}</style>
    <div>Eon · Ekran paylaşılıyor<small>${control ? 'Fare ve klavye erişimi açık' : 'Yalnızca görüntü'}</small></div>
    <nav>${control ? '<a href="https://eon-indicator.invalid/view">Kontrolü kapat</a>' : ''}
    <a href="https://eon-indicator.invalid/stop">Bitir</a></nav></html>`)
}
