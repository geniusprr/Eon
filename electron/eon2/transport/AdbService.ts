import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import fs from 'node:fs/promises'
import { existsSync } from 'node:fs'
import path from 'node:path'

const execFileAsync = promisify(execFile)
const DEVICE_SERIAL = /^[A-Za-z0-9._:-]{1,160}$/
const MAX_STDOUT_BYTES = 128 * 1024

/** Prefer the platform-tools shipped alongside the Android companion in packaged Eon. */
export function resolveAdbBinary(resourcesPath?: string): string {
  const configured = process.env.EON_ADB_PATH
  if (configured && path.isAbsolute(configured) && path.basename(configured).toLowerCase() === 'adb.exe' && existsSync(configured)) return configured
  if (resourcesPath) {
    const bundled = path.join(resourcesPath, 'mobile', 'adb.exe')
    if (existsSync(bundled)) return bundled
  }
  return 'adb'
}

export type AdbDeviceState = 'device' | 'unauthorized' | 'offline' | 'recovery' | 'sideload' | 'unknown'
export interface AdbDevice {
  serial: string
  state: AdbDeviceState
  model: string | null
  product: string | null
  usb: boolean
  /** ADB transport identity changes when a phone disconnects and reconnects. */
  transportId: string | null
}

export function parseAdbDevices(output: string): AdbDevice[] {
  const devices: AdbDevice[] = []
  const lines = output.split(/\r?\n/)
  for (const line of lines) {
    const trimmed = line.trim()
    if (!trimmed || trimmed.startsWith('List of devices') || trimmed.startsWith('* daemon')) continue
    const columns = trimmed.split(/\s+/)
    const serial = columns[0]
    const rawState = columns[1]
    if (!DEVICE_SERIAL.test(serial) || !rawState) continue
    const recognized = ['device', 'unauthorized', 'offline', 'recovery', 'sideload']
    const state: AdbDeviceState = recognized.includes(rawState) ? rawState as AdbDeviceState : 'unknown'
    const metadata = Object.fromEntries(columns.slice(2).filter((item) => /^(model|product):\S+$/.test(item))
      .map((item) => { const index = item.indexOf(':'); return [item.slice(0, index), item.slice(index + 1)] }))
    const usb = !serial.includes(':') && !serial.startsWith('emulator-') && !/\._adb-(?:tls-connect|tls-pairing|connect)\._tcp\.?$/i.test(serial)
    const transportId = columns.slice(2).find(item => /^transport_id:\d+$/.test(item))?.slice('transport_id:'.length) ?? null
    devices.push({ serial, state, model: metadata.model || null, product: metadata.product || null, usb, transportId })
  }
  return devices
}

/** Detect new authorized USB sessions without coupling app launch to reverse-tunnel health. */
export class AuthorizedUsbSessionTracker {
  private readonly sessions = new Map<string, string | null>()

  observe(devices: readonly AdbDevice[]): string[] {
    const authorized = devices.filter(device => device.usb && device.state === 'device')
    const present = new Set(authorized.map(device => device.serial))
    for (const serial of this.sessions.keys()) {
      if (!present.has(serial)) this.sessions.delete(serial)
    }

    const arrivals: string[] = []
    for (const device of authorized) {
      const previousTransport = this.sessions.get(device.serial)
      if (!this.sessions.has(device.serial) ||
          (previousTransport !== null && device.transportId !== null && previousTransport !== device.transportId)) {
        arrivals.push(device.serial)
      }
      this.sessions.set(device.serial, device.transportId)
    }
    return arrivals
  }
}

export class AdbService {
  private readonly binary: string
  private lastDevices: AdbDevice[] = []
  private lastScan = 0

  constructor(binary = resolveAdbBinary((process as NodeJS.Process & { resourcesPath?: string }).resourcesPath)) { this.binary = binary }

  async installApk(serial: string, apkPath: string): Promise<void> {
    await this.requireUsbDevice(serial)
    if (path.extname(apkPath).toLowerCase() !== '.apk') throw new Error('Bir APK dosyası seç.')
    const stat = await fs.stat(apkPath)
    if (!stat.isFile() || stat.size === 0) throw new Error('APK dosyası geçersiz veya boş.')
    const { stdout } = await execFileAsync(this.binary, ['-s', serial, 'install', '-r', apkPath], {
      windowsHide: true, timeout: 120_000, maxBuffer: MAX_STDOUT_BYTES,
    })
    if (!/(^|\r?\n)Success\s*($|\r?\n)/.test(stdout)) throw new Error('Android kurulumu tamamlanamadı. Telefon ekranındaki izni kontrol et.')
  }

  async installCompanion(serial: string, apkPath: string): Promise<void> {
    await this.installApk(serial, apkPath)
    const launch = await execFileAsync(this.binary, ['-s', serial, 'shell', 'am', 'start', '-n', 'com.kapanis.mobil.eon2.dev/com.kapanis.mobil.MainActivity'], {
      windowsHide: true, timeout: 10_000, maxBuffer: MAX_STDOUT_BYTES,
    })
    if (/Error:/i.test(launch.stdout + launch.stderr)) throw new Error('Eon kuruldu. Telefonun uygulama menüsünden aç.')
  }

  async companionInstalled(serial: string): Promise<boolean> {
    await this.requireUsbDevice(serial)
    const { stdout } = await execFileAsync(this.binary, ['-s', serial, 'shell', 'pm', 'list', 'packages', 'com.kapanis.mobil.eon2.dev'], {
      windowsHide: true, timeout: 5000, maxBuffer: MAX_STDOUT_BYTES,
    })
    return stdout.split(/\r?\n/).some(line => line.trim() === 'package:com.kapanis.mobil.eon2.dev')
  }

  async openCompanion(serial: string): Promise<void> {
    await this.requireUsbDevice(serial)
    // Launcher intent flags bring an existing Eon task forward instead of stacking activities.
    const { stdout, stderr } = await execFileAsync(this.binary, ['-s', serial, 'shell', 'am', 'start',
      '-a', 'android.intent.action.MAIN', '-c', 'android.intent.category.LAUNCHER',
      '-f', '0x10200000', '-n', 'com.kapanis.mobil.eon2.dev/com.kapanis.mobil.MainActivity'], {
      windowsHide: true, timeout: 10_000, maxBuffer: MAX_STDOUT_BYTES,
    })
    if (/Error:/i.test(stdout + stderr)) throw new Error('Telefonda Eon uygulamasını aç veya önce kur.')
  }

  async requireUsbDevice(serial: string): Promise<void> {
    if (!DEVICE_SERIAL.test(serial) || serial.includes(':')) throw new Error('USB seri kimliği geçersiz.')
    const devices = await this.list(true)
    if (!devices.some(device => device.serial === serial && device.usb && device.state === 'device')) {
      throw new Error('Yetkilendirilmiş USB cihazı bulunamadı.')
    }
  }

  async list(force = false): Promise<AdbDevice[]> {
    if (!force && Date.now() - this.lastScan < 2500) return this.lastDevices
    const { stdout } = await execFileAsync(this.binary, ['devices', '-l'], {
      windowsHide: true, timeout: 5000, maxBuffer: MAX_STDOUT_BYTES,
    })
    const devices = parseAdbDevices(stdout)
    this.lastDevices = devices
    this.lastScan = Date.now()
    return devices
  }

  async enableReverse(serial: string, androidPort: number, pcPort: number): Promise<void> {
    if (!DEVICE_SERIAL.test(serial) || serial.includes(':')) throw new Error('USB seri kimliği geçersiz.')
    if (![androidPort, pcPort].every((port) => Number.isInteger(port) && port >= 1024 && port <= 65535)) {
      throw new Error('Geçersiz tünel portu.')
    }
    const devices = await this.list(true)
    const target = devices.find((item) => item.serial === serial)
    if (!target || !target.usb || target.state !== 'device') throw new Error('Yetkilendirilmiş USB cihazı bulunamadı.')
    await execFileAsync(this.binary, [ '-s', serial, 'reverse', `tcp:${androidPort}`, `tcp:${pcPort}` ], {
      windowsHide: true, timeout: 5000, maxBuffer: MAX_STDOUT_BYTES,
    })
  }

  async hasReverse(serial: string, androidPort: number, pcPort: number): Promise<boolean> {
    if (!DEVICE_SERIAL.test(serial) || serial.includes(':')) return false
    const { stdout } = await execFileAsync(this.binary, ['-s', serial, 'reverse', '--list'], {
      windowsHide: true, timeout: 5000, maxBuffer: MAX_STDOUT_BYTES,
    })
    return stdout.split(/\r?\n/).some(line => {
      const columns = line.trim().split(/\s+/)
      return columns.at(-2) === `tcp:${androidPort}` && columns.at(-1) === `tcp:${pcPort}`
    })
  }

  async removeReverse(serial: string, androidPort: number): Promise<void> {
    if (!DEVICE_SERIAL.test(serial) || serial.includes(':') || !Number.isInteger(androidPort) || androidPort < 1024 || androidPort > 65535) {
      throw new Error('Geçersiz cihaz veya port.')
    }
    await execFileAsync(this.binary, [ '-s', serial, 'reverse', '--remove', `tcp:${androidPort}` ], {
      windowsHide: true, timeout: 5000, maxBuffer: MAX_STDOUT_BYTES,
    })
  }
}
