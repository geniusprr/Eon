import type { AdbService } from './AdbService.js'
import { readFile } from 'node:fs/promises'
import path from 'node:path'

type Adb = Pick<AdbService, 'companionInstalled' | 'companionVersion' | 'installCompanion' | 'openCompanion'>
export type InstallProgress = { phase: 'checking' | 'installing' | 'error'; message?: string }

/** One installation per USB session; a manual retry shares the same operation. */
export class CompanionInstaller {
  private readonly pending = new Map<string, Promise<void>>()
  private readonly progress = new Map<string, InstallProgress>()
  constructor(private readonly adb: Adb, private readonly apk: string) {}

  status(serial: string): InstallProgress | null { return this.progress.get(serial) ?? null }

  ensure(serial: string): Promise<void> {
    const existing = this.pending.get(serial)
    if (existing) return existing
    const task = this.run(serial).finally(() => { this.pending.delete(serial) })
    this.pending.set(serial, task)
    return task
  }

  private async run(serial: string): Promise<void> {
    this.progress.set(serial, { phase: 'checking' })
    try {
      if (await this.adb.companionInstalled(serial)) {
        const installed = await this.adb.companionVersion(serial)
        let bundled = 0
        try {
          const metadata: unknown = JSON.parse(await readFile(path.join(path.dirname(this.apk), 'version.json'), 'utf8'))
          if (metadata && typeof metadata === 'object' && 'applicationId' in metadata && metadata.applicationId === 'com.kapanis.mobil.eon2.dev' &&
              'versionCode' in metadata && typeof metadata.versionCode === 'number' && Number.isSafeInteger(metadata.versionCode) && metadata.versionCode > 0) bundled = metadata.versionCode
        } catch { /* An absent or invalid manifest must never cause an unverified downgrade. */ }
        if (installed > 0 && bundled > installed) {
          this.progress.set(serial, { phase: 'installing' })
          await this.adb.installCompanion(serial, this.apk)
        } else await this.adb.openCompanion(serial)
      } else {
        this.progress.set(serial, { phase: 'installing' })
        await this.adb.installCompanion(serial, this.apk)
      }
      this.progress.delete(serial)
    } catch (error) {
      this.progress.set(serial, { phase: 'error', message: error instanceof Error ? error.message : 'Telefon kurulumu tamamlanamadı.' })
      throw error
    }
  }
}
