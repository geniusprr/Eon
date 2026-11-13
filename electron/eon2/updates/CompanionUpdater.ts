import { createHash } from 'node:crypto'
import fs from 'node:fs/promises'
import path from 'node:path'
import type { CompanionRelease, CompanionUpdateStatus } from '../../../shared/eon-updates.js'
import type { AdbService } from '../transport/AdbService.js'

const REPOSITORY = 'https://github.com/geniusprr/Eon'
const MAX_APK = 300 * 1024 * 1024

export function parseCompanionManifest(value: unknown, tag: string): CompanionRelease {
  if (!/^v\d+\.\d+\.\d+(?:-[a-zA-Z0-9.-]+)?$/.test(tag)) throw new Error('Yayın etiketi geçersiz.')
  const manifest = value as { schemaVersion?: unknown; version?: unknown; android?: Partial<CompanionRelease> }
  const android = manifest?.android
  if (manifest?.schemaVersion !== 1 || manifest.version !== tag.slice(1) || !android ||
      android.version !== manifest.version || android.packageId !== 'com.kapanis.mobil.eon2.dev' ||
      !Number.isSafeInteger(android.versionCode) || android.versionCode! < 1 || android.versionCode! > 2_147_483_647 ||
      typeof android.sha256 !== 'string' || !/^[a-f0-9]{64}$/.test(android.sha256) ||
      !Number.isSafeInteger(android.size) || android.size! < 1 || android.size! > MAX_APK) {
    throw new Error('Android güncelleme bilgisi doğrulanamadı.')
  }
  return { version: android.version, versionCode: android.versionCode!, packageId: android.packageId,
    sha256: android.sha256, size: android.size!, url: `${REPOSITORY}/releases/download/${tag}/Eon-Android-preview.apk` }
}

async function boundedJson(response: Response, maximum = 256 * 1024): Promise<unknown> {
  if (!response.ok || !response.body) throw new Error(`GitHub yanıtı alınamadı (${response.status}).`)
  const reader = response.body.getReader()
  const chunks: Uint8Array[] = []
  let size = 0
  try {
    while (true) {
      const { value, done } = await reader.read()
      if (done) break
      size += value.length
      if (size > maximum) throw new Error('Güncelleme yanıtı çok büyük.')
      chunks.push(value)
    }
    return JSON.parse(Buffer.concat(chunks).toString('utf8')) as unknown
  } finally { await reader.cancel().catch(() => undefined) }
}

type Dependencies = Pick<AdbService, 'list' | 'companionVersion' | 'installCompanion'>
export class CompanionUpdater {
  status: CompanionUpdateStatus = { phase: 'current', message: 'Android güncellemeleri GitHub Releases üzerinden alınır.', devices: [] }
  private release: CompanionRelease | null = null
  private busy = false
  private installing = false
  private stopped = false
  private readonly abort = new AbortController()
  private readonly offered = new Set<string>()
  constructor(private readonly directory: string, private readonly adb: Dependencies,
    private readonly preview: boolean, private readonly changed: () => void,
    private readonly consent: (name: string, version: string) => Promise<boolean>,
    private readonly fetcher: typeof fetch = fetch) {}

  private report(patch: Partial<CompanionUpdateStatus>) {
    if (this.stopped) return
    this.status = { ...this.status, ...patch }; this.changed()
  }
  private signal() { return AbortSignal.any([this.abort.signal, AbortSignal.timeout(120_000)]) }
  async check() {
    if (this.busy || this.installing || this.stopped) return
    this.busy = true
    const previousPhase = this.status.phase
    this.report({ phase: 'checking', message: 'Android sürümü denetleniyor' })
    try {
      const releases = await boundedJson(await this.fetcher('https://api.github.com/repos/geniusprr/Eon/releases?per_page=20', {
        headers: { Accept: 'application/vnd.github+json', 'User-Agent': 'Eon-Updater' }, signal: this.signal(),
      }))
      if (!Array.isArray(releases)) throw new Error('GitHub yayın listesi geçersiz.')
      const candidate = releases.find((item: { draft?: boolean; prerelease?: boolean; tag_name?: string; assets?: Array<{ name: string }> }) =>
        !item.draft && (this.preview || !item.prerelease) && item.assets?.some(asset => asset.name === 'eon-update.json')) as { tag_name: string } | undefined
      if (!candidate) {
        this.report({ phase: this.release && previousPhase === 'downloaded' ? 'downloaded' : 'current', message: 'Yeni Android güncellemesi yok.' })
        return
      }
      this.release = parseCompanionManifest(await boundedJson(await this.fetcher(
        `${REPOSITORY}/releases/download/${encodeURIComponent(candidate.tag_name)}/eon-update.json`, { signal: this.signal() }), 16 * 1024), candidate.tag_name)
      this.report({ version: this.release.version })
      await this.scanDevices()
      if (!this.status.devices.some(device => device.needsUpdate)) {
        this.report({ phase: 'current', message: this.status.devices.length ? 'Bağlı telefonlar güncel.' : 'Telefon güncellemesi USB bağlantısında hazırlanır.' })
        return
      }
      await this.download(this.release)
      this.report({ phase: 'downloaded', progress: 100, message: 'Telefon güncellemesi kuruluma hazır' })
    } catch { this.report({ phase: 'error', message: 'Telefon güncellemesi alınamadı. Yeniden deneyebilirsin.' }) }
    finally { this.busy = false }
    if (this.status.phase === 'downloaded') await this.offer()
  }
  private apkPath(release: CompanionRelease) { return path.join(this.directory, `${release.sha256}.apk`) }
  private async verified(release: CompanionRelease): Promise<boolean> {
    try {
      const file = await fs.open(this.apkPath(release), 'r')
      try {
        if ((await file.stat()).size !== release.size) return false
        const hash = createHash('sha256')
        for await (const chunk of file.createReadStream({ autoClose: false })) hash.update(chunk)
        return hash.digest('hex') === release.sha256
      } finally { await file.close() }
    } catch { return false }
  }
  private async download(release: CompanionRelease) {
    if (await this.verified(release)) return
    this.report({ phase: 'downloading', progress: 0, message: 'Telefon güncellemesi arka planda indiriliyor' })
    await fs.mkdir(this.directory, { recursive: true })
    const target = this.apkPath(release)
    const temporary = `${target}.part`
    const response = await this.fetcher(release.url, { signal: this.signal() })
    if (!response.ok || !response.body) throw new Error('APK indirilemedi.')
    const reader = response.body.getReader()
    const file = await fs.open(temporary, 'w')
    const hash = createHash('sha256')
    let received = 0; let lastUpdate = 0; let complete = false
    try {
      while (true) {
        const { done, value } = await reader.read()
        if (done) break
        received += value.length
        if (received > release.size) throw new Error('APK boyutu geçersiz.')
        hash.update(value); await file.writeFile(value)
        if (Date.now() - lastUpdate > 250) {
          lastUpdate = Date.now(); this.report({ progress: received / release.size * 100 })
        }
      }
      if (received !== release.size || hash.digest('hex') !== release.sha256) throw new Error('APK bütünlüğü doğrulanamadı.')
      await file.sync()
      complete = true
    } finally {
      await reader.cancel().catch(() => undefined); await file.close()
      if (!complete) await fs.rm(temporary, { force: true }).catch(() => undefined)
    }
    await fs.rename(temporary, target)
  }
  async scanDevices() {
    if (this.stopped || this.installing) return
    try {
      const devices = await this.adb.list()
      const known = await Promise.all(devices.filter(device => device.usb && device.state === 'device').map(async device => {
        const versionCode = await this.adb.companionVersion(device.serial)
        return { serial: device.serial, name: device.model?.replaceAll('_', ' ') || 'Android telefon', versionCode,
          needsUpdate: versionCode > 0 && !!this.release && versionCode < this.release.versionCode }
      }))
      this.report({ devices: known })
    } catch {
      this.report({ devices: [] })
    }
  }
  private async offer() {
    const release = this.release
    if (!release) return
    for (const device of this.status.devices.filter(item => item.needsUpdate)) {
      const key = `${device.serial}:${release.sha256}`
      if (this.offered.has(key)) continue
      this.offered.add(key)
      await this.install(device.serial).catch(() => undefined)
    }
  }
  async install(serial: string) {
    const release = this.release
    if (!release || this.installing || this.status.phase !== 'downloaded') return
    const device = this.status.devices.find(item => item.serial === serial && item.needsUpdate)
    if (!device) throw new Error('Güncellenecek USB telefonu bulunamadı.')
    this.installing = true
    try {
      if (!await this.consent(device.name, release.version) || this.stopped) return
      if (!await this.verified(release)) throw new Error('APK doğrulanamadı. Yeniden indir.')
      const installed = await this.adb.companionVersion(serial)
      if (!installed || installed >= release.versionCode) return
      this.report({ phase: 'installing', message: `${device.name} güncelleniyor…` })
      await this.adb.installCompanion(serial, this.apkPath(release))
      if (await this.adb.companionVersion(serial) !== release.versionCode) throw new Error('Telefondaki sürüm doğrulanamadı.')
      this.report({ phase: 'downloaded', message: `${device.name} güncellendi.` })
    } catch { this.report({ phase: 'downloaded', message: 'Telefon kurulamadı. USB bağlantısını ve imza uyumunu kontrol edip tekrar dene.' }) }
    finally { this.installing = false; await this.scanDevices() }
  }
  dispose() { this.stopped = true; this.abort.abort() }
}
