import { spawn, execFile, type ChildProcessWithoutNullStreams } from 'node:child_process'
import { statSync } from 'node:fs'
import path from 'node:path'
import { promisify } from 'node:util'
import { randomUUID } from 'node:crypto'
import { setTimeout as delay } from 'node:timers/promises'
import { AdbService } from '../transport/AdbService.js'
import { findScrcpyWindow, type WindowHandle } from './ScrcpyWindow.js'
import type { PhoneScreenMode, PhoneScreenStatus } from '../../../shared/phone-screen.js'

const execFileAsync = promisify(execFile)
const SERIAL_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._-]{0,159}$/

function validScrcpyBinary(candidate: string): boolean {
  if (!path.isAbsolute(candidate) || path.basename(candidate).toLowerCase() !== 'scrcpy.exe') return false
  try { return statSync(candidate).isFile() } catch { return false }
}

export interface ScrcpyOptions {
  maxSize?: number
  maxFps?: number
  bitRateMbps?: number
  showTouches?: boolean
  turnScreenOff?: boolean
  /** Initial SDL renderer size, in physical desktop pixels, before the HWND is embedded. */
  windowWidth?: number
  windowHeight?: number
}

export type ScrcpyStatus = PhoneScreenStatus

export function scrcpyArguments(serial: string, options: ScrcpyOptions = {}): string[] {
  if (!SERIAL_PATTERN.test(serial)) throw new Error('Yalnız USB cihaz seri numarası kullanılabilir.')
  const maxSize = options.maxSize ?? 1920
  const maxFps = options.maxFps ?? 60
  const bitRateMbps = options.bitRateMbps ?? 8
  if (!Number.isInteger(maxSize) || maxSize < 480 || maxSize > 3840) throw new Error('Geçersiz scrcpy çözünürlüğü.')
  if (!Number.isInteger(maxFps) || maxFps < 15 || maxFps > 120) throw new Error('Geçersiz scrcpy FPS değeri.')
  if (!Number.isInteger(bitRateMbps) || bitRateMbps < 1 || bitRateMbps > 24) throw new Error('Geçersiz scrcpy bitrate.')
  const args = ['--serial', serial, '--max-size', String(maxSize), '--max-fps', String(maxFps), '--video-bit-rate', String(bitRateMbps) + 'M', '--window-title', 'Eon Android – ' + serial]
  for (const field of ['windowWidth', 'windowHeight'] as const) {
    const value = options[field]
    if (value !== undefined) {
      if (!Number.isInteger(value) || value < 48 || value > 3840) throw new Error('Geçersiz scrcpy pencere boyutu.')
      args.push(field === 'windowWidth' ? '--window-width' : '--window-height', String(value))
    }
  }
  if (options.showTouches === true) args.push('--show-touches')
  if (options.turnScreenOff === true) args.push('--turn-screen-off')
  return args
}

export async function locateScrcpy(): Promise<string> {
  const configured = process.env.EON_SCRCPY_PATH
  if (configured && validScrcpyBinary(configured)) return configured
  // Prefer the bundled executable when running the packaged app. The user may
  // still explicitly select a verified scrcpy.exe with EON_SCRCPY_PATH.
  const resourcesPath = process.resourcesPath
  if (typeof resourcesPath === 'string' && path.isAbsolute(resourcesPath)) {
    const packaged = path.join(resourcesPath, 'scrcpy', 'scrcpy.exe')
    if (validScrcpyBinary(packaged)) return packaged
  }
  // No arbitrary shell command: where.exe only resolves a fixed, verified executable name.
  try {
    const { stdout } = await execFileAsync('where.exe', ['scrcpy.exe'], { windowsHide: true, timeout: 3000, maxBuffer: 32_768 })
    const candidate = stdout.split(/\r?\n/).map(value => value.trim()).find(validScrcpyBinary)
    if (candidate) return candidate
  } catch { /* scrcpy not in PATH */ }
  throw new Error('scrcpy.exe bulunamadı. Resmî Genymobile/scrcpy dağıtımını kurup PATH ortam değişkenine ekle.')
}

export class ScrcpyManager {
  private child: ChildProcessWithoutNullStreams | null = null
  private window: WindowHandle | null = null
  private generation = 0
  private disposed = false
  private status: ScrcpyStatus = { state: 'idle' }
  private onStatusListeners = new Set<(status: ScrcpyStatus) => void>()

  constructor(private readonly adb = new AdbService()) {}

  getStatus(): ScrcpyStatus { return { ...this.status } }
  getWindow(): WindowHandle | null { return this.window }

  setMode(mode: PhoneScreenMode): ScrcpyStatus {
    if (this.status.state !== 'running') throw new Error('Telefon ekranı henüz hazır değil.')
    this.notify({ ...this.status, mode })
    return this.getStatus()
  }

  subscribe(onStatus: (status: ScrcpyStatus) => void): () => void {
    this.onStatusListeners.add(onStatus)
    return () => this.onStatusListeners.delete(onStatus)
  }

  private notify(status: ScrcpyStatus) {
    this.status = status
    for (const callback of this.onStatusListeners) {
      try { callback(this.getStatus()) } catch { /* Observer must not break native process lifecycle. */ }
    }
  }

  async start(serial: string, options: ScrcpyOptions = {}): Promise<ScrcpyStatus> {
    // Validate all inputs before starting any process.
    const args = scrcpyArguments(serial, options)
    if (this.disposed || this.child || this.status.state === 'starting') throw new Error('Bir scrcpy oturumu zaten çalışıyor.')
    const generation = ++this.generation
    const startedAt = Date.now()
    this.notify({ state: 'starting', serial, startedAt, mode: 'embedded' })

    try {
      const device = (await this.adb.list(true)).find(item => item.serial === serial)
      if (!device || !device.usb || device.state !== 'device') throw new Error('Seçilen yetkili USB Android cihazı bulunamadı.')
      const binary = await locateScrcpy()
      if (generation !== this.generation) return this.getStatus()
      const title = 'Eon Android ' + randomUUID()
      args[args.indexOf('--window-title') + 1] = title
      args.push('--window-borderless', '--window-x=-10000', '--window-y=-10000')
      const child = spawn(binary, args, {
        cwd: path.dirname(binary), windowsHide: true, shell: false, stdio: ['pipe', 'pipe', 'pipe'],
      })
      this.child = child
      let tail = ''
      child.stdout.resume()
      child.stderr.setEncoding('utf8')
      child.stderr.on('data', (value: string) => { tail = (tail + value).slice(-2048) })
      child.once('spawn', () => {
        void this.waitForWindow(child, title, serial, startedAt).catch(error => {
          if (this.child === child) this.fail(error instanceof Error ? error.message : 'Telefon ekranı açılamadı.')
        })
      })
      child.once('error', (error) => {
        if (this.child !== child) return
        this.child = null
        this.window = null
        this.notify({ state: 'error', message: 'scrcpy başlatılamadı: ' + error.message })
      })
      child.once('exit', (code, signal) => {
        if (this.child !== child) return
        this.child = null
        this.window = null
        if (code === 0 || signal === 'SIGTERM') this.notify({ state: 'idle' })
        else this.notify({ state: 'error', message: ('scrcpy kapandı (kod: ' + String(code ?? 'unknown') + '). ' + tail.slice(-320)).trim() })
      })
      return this.getStatus()
    } catch (error) {
      if (generation !== this.generation) return this.getStatus()
      this.child = null
      this.notify({ state: 'error', message: error instanceof Error ? error.message : 'scrcpy çalıştırılamadı.' })
      throw error
    }
  }

  private async waitForWindow(child: ChildProcessWithoutNullStreams, title: string, serial: string, startedAt: number) {
    const deadline = Date.now() + 12_000
    while (this.child === child && Date.now() < deadline) {
      const window = child.pid && findScrcpyWindow(title, child.pid)
      if (window) {
        this.window = window
        this.notify({ state: 'running', serial, startedAt, mode: 'embedded' })
        return
      }
      await delay(80)
    }
    if (this.child === child) throw new Error('Telefon ekranı zamanında açılmadı. Telefonun kilidini ve USB bağlantısını kontrol et.')
  }

  private end(status: ScrcpyStatus): ScrcpyStatus {
    this.generation++
    const active = this.child
    this.child = null
    this.window = null
    try { active?.kill('SIGTERM') } catch { /* Process may have exited already. */ }
    this.notify(status)
    return this.getStatus()
  }

  stop() { return this.end({ state: 'idle' }) }
  fail(message: string) { return this.end({ state: 'error', message }) }
  dispose() { this.disposed = true; this.stop(); this.onStatusListeners.clear() }
}
