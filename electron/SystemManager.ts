import { app } from 'electron'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import type { AppSettings, TimerAction, TimerState } from '../src/types.js'

const execFileAsync = promisify(execFile)
const MAX_TIMER_SECONDS = 315_360_000
const MAX_TERMINAL_COMMAND_LENGTH = 4_096
const MAX_TERMINAL_OUTPUT_LENGTH = 64 * 1_024

export interface ElevatedCommandResult {
  stdout: string
  stderr: string
  exitCode: number | null
  timedOut: boolean
  truncated: boolean
}

export class SystemManager {
  private readonly dataDir: string
  private readonly timerPath: string
  private readonly settingsPath: string
  private timer: TimerState | null
  private elevated: boolean | null = null

  constructor(dataDir: string) {
    this.dataDir = dataDir
    this.timerPath = path.join(dataDir, 'timer-state.json')
    this.settingsPath = path.join(dataDir, 'settings.json')
    fs.mkdirSync(dataDir, { recursive: true })
    this.timer = this.readTimer()
  }

  getTimerStatus() {
    if (this.timer && this.timer.targetAt <= Date.now()) {
      this.timer = null
      this.persistTimer()
    }
    return this.timer ? { ...this.timer } : null
  }

  async toggleShutdown(action: TimerAction, seconds: number, shortcutId: string) {
    const timer = this.getTimerStatus()
    if (timer?.shortcutId === shortcutId && timer.action === action) {
      await this.cancelShutdown()
      return null
    }
    return this.scheduleShutdown(action, Math.max(1, seconds), seconds > 0 ? shortcutId : undefined)
  }

  async scheduleShutdown(action: TimerAction, seconds: number, shortcutId?: string) {
    if (!Number.isInteger(seconds) || seconds < 1 || seconds > MAX_TIMER_SECONDS) {
      throw new Error('Zamanlayıcı 1 saniye ile 10 yıl arasında olmalı.')
    }
    if (action !== 'shutdown' && action !== 'restart') throw new Error('Geçersiz Windows işlemi seçildi.')
    if (this.timer) await this.cancelShutdown()
    await this.runWindowsCommand([action === 'shutdown' ? '/s' : '/r', '/t', String(seconds)])
    this.timer = { action, targetAt: Date.now() + seconds * 1_000, durationSeconds: seconds, shortcutId }
    this.persistTimer()
    return { ...this.timer }
  }

  async cancelShutdown() {
    const hadTimer = Boolean(this.timer)
    const commandError = await this.runWindowsCommand(['/a']).catch((error) => error as Error)
    if (hadTimer && commandError instanceof Error) throw commandError
    this.timer = null
    this.persistTimer()
  }

  restoreTimer() {
    const timer = this.getTimerStatus()
    if (!timer) return
    const remaining = Math.max(1, Math.ceil((timer.targetAt - Date.now()) / 1_000))
    void this.runWindowsCommand(['/a'])
      .then(() => this.runWindowsCommand([timer.action === 'shutdown' ? '/s' : '/r', '/t', String(remaining)]))
      .catch((error) => console.error('[system] timer restore failed', error))
  }

  async getInfo() {
    return { hostname: os.hostname() || 'Windows PC', os: process.platform === 'win32' ? 'Windows' : os.platform(), platform: process.platform }
  }

  /**
   * The local mobile terminal deliberately inherits the desktop process token.
   * It never tries to bypass UAC: the desktop app must have been launched with
   * "Run as administrator" for remotely sent commands to be accepted.
   */
  async isRunningAsAdministrator() {
    if (process.platform !== 'win32') return false
    if (this.elevated !== null) return this.elevated

    try {
      const { stdout } = await execFileAsync(
        'powershell.exe',
        [
          '-NoProfile',
          '-NonInteractive',
          '-Command',
          "$principal = New-Object Security.Principal.WindowsPrincipal([Security.Principal.WindowsIdentity]::GetCurrent()); if ($principal.IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)) { '1' } else { '0' }",
        ],
        { windowsHide: true, timeout: 3_000, maxBuffer: 1_024 },
      )
      this.elevated = stdout.trim() === '1'
    } catch {
      this.elevated = false
    }

    return this.elevated
  }

  async executeElevatedCmd(command: string): Promise<ElevatedCommandResult> {
    if (process.platform !== 'win32') throw new Error('CMD komutları yalnızca Windows üzerinde çalışır.')

    const normalized = command.trim()
    if (!normalized) throw new Error('Komut boş olamaz.')
    if (normalized.length > MAX_TERMINAL_COMMAND_LENGTH) throw new Error(`Komut en fazla ${MAX_TERMINAL_COMMAND_LENGTH} karakter olabilir.`)
    if (normalized.includes('\u0000')) throw new Error('Komut geçersiz bir karakter içeriyor.')
    if (!await this.isRunningAsAdministrator()) {
      const error = new Error('Yönetici CMD oturumu için bilgisayardaki Eon uygulamasını "Yönetici olarak çalıştır" ile yeniden açın.')
      ;(error as Error & { code?: string }).code = 'ELEVATION_REQUIRED'
      throw error
    }

    try {
      const { stdout, stderr } = await execFileAsync(
        'cmd.exe',
        ['/d', '/s', '/c', normalized],
        {
          windowsHide: true,
          timeout: 30_000,
          maxBuffer: MAX_TERMINAL_OUTPUT_LENGTH * 2,
        },
      )
      const clipped = clipTerminalOutput(stdout, stderr)
      return { ...clipped, exitCode: 0, timedOut: false }
    } catch (error) {
      const typed = error as {
        code?: number | string
        killed?: boolean
        stdout?: string
        stderr?: string
        message?: string
      }
      const clipped = clipTerminalOutput(typed.stdout || '', typed.stderr || '')
      const timedOut = typed.code === 'ETIMEDOUT' || typed.killed === true
      const exitCode = typeof typed.code === 'number' ? typed.code : null
      const fallback = timedOut
        ? 'Komut 30 saniye içinde tamamlanmadığı için durduruldu.'
        : exitCode === null
          ? 'CMD başlatılamadı.'
          : `Komut ${exitCode} çıkış koduyla tamamlandı.`

      return {
        stdout: clipped.stdout,
        stderr: clipped.stderr || fallback,
        exitCode,
        timedOut,
        truncated: clipped.truncated,
      }
    }
  }

  getSettings(): AppSettings | null {
    try {
      const raw = fs.readFileSync(this.settingsPath, 'utf8')
      return JSON.parse(raw) as AppSettings
    } catch {
      return null
    }
  }

  saveSettings(settings: AppSettings) {
    fs.writeFileSync(this.settingsPath, JSON.stringify(settings, null, 2), 'utf8')
  }

  getAutostart() {
    try { return app.getLoginItemSettings({ args: ['--background'] }).openAtLogin } catch { return false }
  }

  setAutostart(enabled: boolean) {
    app.setLoginItemSettings({ openAtLogin: enabled, args: ['--background'], openAsHidden: true })
    return this.getAutostart()
  }

  async openExternal(url: string) {
    // Kept as an explicit service boundary so all external actions pass through
    // the same validation in WindowManager's IPC handler.
    return url
  }

  private async runWindowsCommand(args: string[]) {
    if (process.platform !== 'win32') throw new Error('Windows sistem komutu yalnızca Windows üzerinde kullanılabilir.')
    try {
      await execFileAsync('shutdown.exe', args, { windowsHide: true, timeout: 10_000 })
    } catch (error) {
      const typed = error as { code?: number | string; stderr?: string; stdout?: string; message?: string }
      if (args[0] === '/a' && typed.code === 1116) return // ERROR_NO_SHUTDOWN_IN_PROGRESS
      throw new Error((typed.stderr || typed.stdout || typed.message || 'Windows komutu başarısız oldu.').trim())
    }
  }

  private readTimer() {
    try {
      const value = JSON.parse(fs.readFileSync(this.timerPath, 'utf8')) as Partial<TimerState>
      if ((value.action === 'shutdown' || value.action === 'restart') && typeof value.targetAt === 'number' && typeof value.durationSeconds === 'number' && value.targetAt > Date.now()) {
        return { action: value.action, targetAt: value.targetAt, durationSeconds: value.durationSeconds,
          shortcutId: typeof value.shortcutId === 'string' ? value.shortcutId : undefined }
      }
    } catch { /* no timer persisted */ }
    try { fs.rmSync(this.timerPath, { force: true }) } catch { /* best effort */ }
    return null
  }

  private persistTimer() {
    try {
      if (this.timer) fs.writeFileSync(this.timerPath, JSON.stringify(this.timer, null, 2), 'utf8')
      else fs.rmSync(this.timerPath, { force: true })
    } catch (error) { console.error('[system] timer state could not be persisted', error) }
  }
}

function clipTerminalOutput(stdout: string, stderr: string) {
  const combinedLength = stdout.length + stderr.length
  if (combinedLength <= MAX_TERMINAL_OUTPUT_LENGTH) return { stdout, stderr, truncated: false }

  const stdoutLimit = Math.min(stdout.length, Math.floor(MAX_TERMINAL_OUTPUT_LENGTH * 0.75))
  const stderrLimit = Math.max(0, MAX_TERMINAL_OUTPUT_LENGTH - stdoutLimit)
  return {
    stdout: stdout.slice(0, stdoutLimit),
    stderr: stderr.slice(0, stderrLimit),
    truncated: true,
  }
}
