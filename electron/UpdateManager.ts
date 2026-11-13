import { app, type BrowserWindow } from 'electron'
import electronUpdater from 'electron-updater'
import type { AppUpdateStatus } from '../shared/contracts.js'
import { DesktopUpdateController } from './eon2/updates/DesktopUpdateController.js'

const { autoUpdater } = electronUpdater
type UpdateManagerOptions = {
  getMainWindow: () => BrowserWindow | null
  reportStatus: (status: AppUpdateStatus) => void
  beforeInstall: () => void
}

export class UpdateManager {
  readonly controller: DesktopUpdateController
  private timer?: ReturnType<typeof setInterval>
  private readonly cleanup: Array<() => void> = []
  constructor(options: UpdateManagerOptions) {
    autoUpdater.autoDownload = false
    autoUpdater.autoInstallOnAppQuit = false
    autoUpdater.allowPrerelease = app.getVersion().includes('-')
    autoUpdater.allowDowngrade = false
    this.controller = new DesktopUpdateController(app.getVersion(), {
      check: () => autoUpdater.checkForUpdates(),
      download: () => autoUpdater.downloadUpdate(),
      install: () => { options.beforeInstall(); setImmediate(() => autoUpdater.quitAndInstall(false, true)) },
    }, options.reportStatus, app.isPackaged && process.env.KAPANIS_SMOKE_TEST !== '1')
    const available = (info: { version: string }) => this.controller.available(info.version)
    const current = () => this.controller.current()
    const progress = (value: { percent: number }) => this.controller.progress(value.percent)
    const downloaded = (info: { version: string }) => this.controller.downloaded(info.version)
    const failed = () => this.controller.failed()
    autoUpdater.on('update-available', available)
    autoUpdater.on('update-not-available', current)
    autoUpdater.on('download-progress', progress)
    autoUpdater.on('update-downloaded', downloaded)
    autoUpdater.on('error', failed)
    this.cleanup.push(() => {
      autoUpdater.removeListener('update-available', available)
      autoUpdater.removeListener('update-not-available', current)
      autoUpdater.removeListener('download-progress', progress)
      autoUpdater.removeListener('update-downloaded', downloaded)
      autoUpdater.removeListener('error', failed)
    })
  }
  async checkOnLaunch() {
    if (!this.timer && app.isPackaged && process.env.KAPANIS_SMOKE_TEST !== '1') {
      this.timer = setInterval(() => { void this.controller.check() }, 4 * 60 * 60 * 1000)
      this.timer.unref()
    }
    await this.controller.check()
  }
  // Kept for the legacy window visibility callback; updates no longer interrupt users.
  async promptForAvailableUpdate() { await this.controller.download() }
  dispose() {
    clearInterval(this.timer)
    for (const dispose of this.cleanup) dispose()
  }
}
