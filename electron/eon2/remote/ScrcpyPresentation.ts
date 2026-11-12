import { screen, type BrowserWindow } from 'electron'
import type { PhoneScreenMode, PhoneScreenSlot } from '../../../shared/phone-screen.js'
import type { ScrcpyManager } from './ScrcpyManager.js'
import { getClientSize, hideScrcpy, isScrcpyWindow, placeScrcpy, presentScrcpy, type WindowHandle } from './ScrcpyWindow.js'

function handle(window: BrowserWindow): WindowHandle {
  const buffer = window.getNativeWindowHandle()
  return buffer.length >= 8 ? buffer.readBigUInt64LE() : buffer.readUInt32LE()
}

export function readPhoneScreenSlot(value: unknown): PhoneScreenSlot | null {
  if (value === null) return null
  if (!value || typeof value !== 'object') throw new Error('Geçersiz telefon ekranı alanı.')
  const fields = value as Record<keyof PhoneScreenSlot, unknown>
  const read = (key: keyof PhoneScreenSlot) => {
    const number = fields[key]
    if (typeof number !== 'number' || !Number.isFinite(number) || number < 0 || number > 16384) throw new Error('Geçersiz ekran ölçüsü.')
    return number
  }
  const slot = { x: read('x'), y: read('y'), width: read('width'), height: read('height'), viewportWidth: read('viewportWidth'), viewportHeight: read('viewportHeight') }
  if (slot.width < 48 || slot.height < 48 || slot.x + slot.width > slot.viewportWidth || slot.y + slot.height > slot.viewportHeight) {
    throw new Error('Telefon ekranı Eon penceresinin içinde olmalı.')
  }
  return slot
}

export class ScrcpyPresentation {
  private slot: PhoneScreenSlot | null = null
  private presentedWindow: WindowHandle | null = null
  private presentedMode: PhoneScreenMode | null = null
  private lastPlacement = ''
  private readonly stopListening: () => void
  private readonly timer: NodeJS.Timeout

  constructor(private readonly main: BrowserWindow, private readonly manager: ScrcpyManager) {
    this.stopListening = manager.subscribe(status => {
      if (status.state === 'running') this.refresh()
      else {
        if (this.presentedWindow && isScrcpyWindow(this.presentedWindow)) hideScrcpy(this.presentedWindow)
        this.presentedWindow = null
        this.presentedMode = null
        this.lastPlacement = ''
      }
    })
    this.timer = setInterval(() => this.refresh(), 350)
    this.timer.unref()
  }

  layout(value: unknown) {
    try {
      this.slot = readPhoneScreenSlot(value)
    } catch (error) {
      // A stale native child must not cover unrelated content if the renderer
      // sent an invalid layout while its surface was being replaced.
      this.slot = null
      this.refresh()
      throw error
    }
    this.refresh()
  }

  setMode(value: unknown) {
    if (value !== 'embedded' && value !== 'window' && value !== 'pip') throw new Error('Geçersiz ekran görünümü.')
    if (this.main.isDestroyed()) throw new Error('Eon penceresi kapandı.')
    const status = this.manager.getStatus()
    if (status.state !== 'running') throw new Error('Telefon ekranı henüz hazır değil.')
    if (value === status.mode) {
      // Reopen an external native window that the user has minimised.
      if (value !== 'embedded') this.lastPlacement = ''
      this.refresh()
      return this.manager.getStatus()
    }
    if (value !== 'embedded') this.floatingBounds(value)
    this.manager.setMode(value)
    if (value === 'embedded' && this.manager.getStatus().state === 'running' && this.main.isVisible()) this.main.focus()
    return this.manager.getStatus()
  }

  private embeddedBounds(): Electron.Rectangle | null {
    if (!this.slot || !this.main.isVisible() || this.main.isMinimized()) return null
    // The DOM sends CSS pixels relative to the renderer viewport. Electron
    // content bounds are DIP; screen.dipToScreenRect converts once for Win32.
    const content = this.main.getContentBounds()
    const { x, y, width, height, viewportWidth, viewportHeight } = this.slot
    const dip = {
      x: content.x + Math.round(x * content.width / viewportWidth),
      y: content.y + Math.round(y * content.height / viewportHeight),
      width: Math.round(width * content.width / viewportWidth),
      height: Math.round(height * content.height / viewportHeight),
    }
    if (dip.width < 1 || dip.height < 1) return null
    return screen.dipToScreenRect(this.main, dip)
  }

  private floatingBounds(mode: Exclude<PhoneScreenMode, 'embedded'>): Electron.Rectangle {
    const { workArea } = screen.getDisplayMatching(this.main.getBounds())
    const availableWidth = Math.floor(workArea.width)
    const availableHeight = Math.floor(workArea.height)
    if (availableWidth < 220 || availableHeight < 220) throw new Error('Telefon ekranı için yeterli masaüstü alanı yok.')
    const pip = mode === 'pip'
    const width = Math.min(availableWidth, pip ? 300 : 450)
    const height = Math.min(availableHeight, pip ? 485 : 740)
    const insetX = Math.min(16, Math.floor((availableWidth - width) / 2))
    const insetY = Math.min(16, Math.floor((availableHeight - height) / 2))
    const bounds = pip
      ? { x: workArea.x + availableWidth - width - insetX, y: workArea.y + availableHeight - height - insetY, width, height }
      : { x: workArea.x + Math.floor((availableWidth - width) / 2), y: workArea.y + Math.floor((availableHeight - height) / 2), width, height }
    return screen.dipToScreenRect(this.main, bounds)
  }

  private refresh() {
    const status = this.manager.getStatus()
    const child = this.manager.getWindow()
    if (!child || status.state !== 'running') return
    try {
      if (!isScrcpyWindow(child)) throw new Error('Telefon ekranı penceresi beklenmedik şekilde kapandı.')
      if (this.main.isDestroyed()) { hideScrcpy(child); return }
      if (this.presentedWindow !== child || this.presentedMode !== status.mode) {
        presentScrcpy(child, status.mode === 'embedded' ? handle(this.main) : null, status.mode)
        this.presentedWindow = child
        this.presentedMode = status.mode
        this.lastPlacement = ''
      }
      if (status.mode === 'embedded') {
        const bounds = this.embeddedBounds()
        if (!bounds) {
          if (this.lastPlacement !== 'hidden') hideScrcpy(child)
          this.lastPlacement = 'hidden'
          return
        }
        const { x, y, width, height } = bounds
        const placement = `embedded:${x}:${y}:${width}:${height}`
        const actual = getClientSize(child)
        if (this.lastPlacement !== placement || actual.width !== width || actual.height !== height) {
          placeScrcpy(child, x, y, width, height)
          this.lastPlacement = placement
        }
      } else {
        // Do not snap an independently dragged/resized external window back
        // every 350 ms. Placement is performed on entering the mode or reopen.
        if (!this.lastPlacement) {
          const { x, y, width, height } = this.floatingBounds(status.mode)
          placeScrcpy(child, x, y, width, height, status.mode === 'pip')
          this.lastPlacement = status.mode
        }
      }
    } catch (error) {
      this.manager.fail(error instanceof Error ? error.message : 'Telefon ekranı gösterilemedi.')
    }
  }

  dispose() {
    clearInterval(this.timer)
    this.stopListening()
    if (this.presentedWindow && isScrcpyWindow(this.presentedWindow)) hideScrcpy(this.presentedWindow)
    this.presentedWindow = null
    this.presentedMode = null
  }
}
