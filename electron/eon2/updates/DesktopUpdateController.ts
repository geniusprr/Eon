import type { AppUpdateStatus } from '../../../shared/contracts.js'

export interface DesktopUpdaterPort {
  check(): Promise<unknown>
  download(): Promise<unknown>
  install(): void
}

/** A downloaded installer is never applied on exit or without a user action. */
export class DesktopUpdateController {
  status: AppUpdateStatus
  private checking = false
  private downloading = false
  private installing = false
  constructor(private readonly version: string, private readonly port: DesktopUpdaterPort,
    private readonly changed: (status: AppUpdateStatus) => void, private readonly enabled = true) {
    this.status = { phase: enabled ? 'checking' : 'current', currentVersion: version,
      message: enabled ? 'Güncelleme bilgisi bekleniyor' : 'Geliştirme sürümü · kurulu uygulamada denetlenir' }
  }
  report(patch: Partial<AppUpdateStatus>) {
    this.status = { ...this.status, ...patch, currentVersion: this.version }
    this.changed(this.status)
  }
  async check() {
    if (this.checking || this.downloading || this.status.phase === 'downloaded') return
    if (!this.enabled) { this.report({ phase: 'current', message: 'Geliştirme sürümü · kurulu uygulamada denetlenir' }); return }
    this.checking = true
    this.report({ phase: 'checking', message: 'GitHub Releases denetleniyor' })
    try { await this.port.check() }
    catch { this.failed() }
    finally { this.checking = false }
  }
  available(version: string) {
    if (this.status.availableVersion === version && (this.downloading || this.status.phase === 'downloaded')) return
    this.report({ phase: 'available', availableVersion: version, progress: 0, message: `Eon ${version} bulundu` })
    void this.download()
  }
  current() { this.report({ phase: 'current', availableVersion: undefined, progress: undefined, message: 'Eon güncel' }) }
  progress(percent: number) {
    if (this.status.phase !== 'downloading') return
    const progress = Number.isFinite(percent) ? Math.max(0, Math.min(100, percent)) : 0
    this.report({ progress, message: `Güncelleme indiriliyor · %${Math.round(progress)}` })
  }
  downloaded(version: string) {
    this.report({ phase: 'downloaded', availableVersion: version, progress: 100, message: 'Kuruluma hazır' })
  }
  failed() { this.installing = false; this.report({ phase: 'error', message: 'Güncelleme alınamadı. Bağlantını kontrol edip yeniden dene.' }) }
  async download() {
    if (this.downloading || !this.status.availableVersion || this.status.phase === 'downloaded') return
    this.downloading = true
    this.report({ phase: 'downloading', progress: 0, message: 'Güncelleme arka planda indiriliyor' })
    try { await this.port.download() }
    catch { this.failed() }
    finally { this.downloading = false }
  }
  install() {
    if (this.status.phase !== 'downloaded') throw new Error('Güncelleme henüz kuruluma hazır değil.')
    if (this.installing) return
    this.installing = true
    this.port.install()
  }
}
