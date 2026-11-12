import { useCallback, useEffect, useRef, useState } from 'react'
import { AlertCircle, ArrowUpRight, CheckCircle2, CircleDot, LoaderCircle, Monitor, MonitorPlay, PictureInPicture2, PlugZap, Smartphone, Square } from 'lucide-react'
import type { IpcChannel } from '../../shared/contracts'
import type { PhoneScreenMode, PhoneScreenSlot, PhoneScreenStatus } from '../../shared/phone-screen'
import './phone-screen.css'

export type Device = { serial: string; model: string | null; state: string; usb: boolean }
type Props = { devices: Device[]; compact?: boolean; minimal?: boolean }
type Action = 'start' | 'stop' | 'mode' | null

const MODES: { id: PhoneScreenMode; label: string; icon: typeof Monitor }[] = [
  { id: 'embedded', label: 'Eon içinde', icon: Monitor },
  { id: 'window', label: 'Pencere', icon: ArrowUpRight },
  { id: 'pip', label: 'PiP', icon: PictureInPicture2 },
]

// Only one renderer surface owns the native child HWND at a time. Serialising
// layout commands also prevents a departing view from hiding a newly mounted one.
let currentSurface: symbol | null = null
let layoutQueue: Promise<void> = Promise.resolve()

function desktopInvoke<T>(channel: IpcChannel, payload?: unknown): Promise<T> {
  if (!window.kapanisDesktop) return Promise.reject(new Error('Ekran kontrolü yalnızca Eon masaüstü uygulamasında kullanılabilir.'))
  return window.kapanisDesktop.invoke(channel, payload) as Promise<T>
}

function sendLayout(owner: symbol, slot: PhoneScreenSlot | null, release = false): Promise<void> {
  layoutQueue = layoutQueue.catch(() => undefined).then(async () => {
    if (release ? currentSurface !== null : currentSurface !== owner) return
    await desktopInvoke<void>('eon2:scrcpy:layout', slot)
  })
  return layoutQueue
}

function visibleScreenSlot(element: HTMLElement | null): PhoneScreenSlot | null {
  if (!element?.isConnected || document.hidden || !element.getClientRects().length) return null
  if (getComputedStyle(element).visibility !== 'visible') return null

  const viewportWidth = document.documentElement.clientWidth
  const viewportHeight = window.innerHeight
  const rect = element.getBoundingClientRect()
  // An Electron-owned native video popup draws above Chromium. Hide it when
  // another DOM layer (for example a modal) covers the video centre.
  const topElement = document.elementFromPoint((rect.left + rect.right) / 2, (rect.top + rect.bottom) / 2)
  if (!topElement || !element.contains(topElement)) return null
  let left = Math.max(0, rect.left)
  let right = Math.min(viewportWidth, rect.right)
  let top = Math.max(0, rect.top)
  let bottom = Math.min(viewportHeight, rect.bottom)

  // A native window is drawn above the DOM, so it must also respect scroll
  // containers that clip the video slot (the main Eon content column among them).
  for (let parent = element.parentElement; parent; parent = parent.parentElement) {
    const overflow = getComputedStyle(parent)
    const bounds = parent.getBoundingClientRect()
    if (/(auto|scroll|hidden|clip)/.test(overflow.overflowX)) {
      left = Math.max(left, bounds.left)
      right = Math.min(right, bounds.right)
    }
    if (/(auto|scroll|hidden|clip)/.test(overflow.overflowY)) {
      top = Math.max(top, bounds.top)
      bottom = Math.min(bottom, bounds.bottom)
    }
  }

  const x = Math.max(0, Math.floor(left))
  const y = Math.max(0, Math.floor(top))
  const width = Math.floor(right) - x
  const height = Math.floor(bottom) - y
  if (width < 48 || height < 48 || !Number.isFinite(width + height)) return null
  return { x, y, width, height, viewportWidth, viewportHeight }
}

function readableModel(device: Device | undefined): string {
  return device?.model?.replace(/_/g, ' ') || 'Android cihaz'
}

export function PhoneScreenSurface({ devices, compact = false, minimal = false }: Props) {
  const [status, setStatus] = useState<PhoneScreenStatus>({ state: 'idle' })
  const [loaded, setLoaded] = useState(false)
  const [selectedSerial, setSelectedSerial] = useState<string | null>(null)
  const [action, setAction] = useState<Action>(null)
  const [actionError, setActionError] = useState<string | null>(null)
  const [previewOrientation, setPreviewOrientation] = useState<'portrait' | 'landscape'>('portrait')
  const screenRef = useRef<HTMLDivElement>(null)
  const ownerRef = useRef<symbol | null>(null)
  const lastLayoutRef = useRef<string | null>(null)
  const statusRef = useRef<PhoneScreenStatus>(status)
  const busyRef = useRef(false)
  const aliveRef = useRef(true)
  const allowEmbeddedRef = useRef(true)

  const authorised = devices.filter(device => device.usb && device.state === 'device')
  const activeSerial = status.state === 'starting' || status.state === 'running' ? status.serial : null
  const selected = authorised.find(device => device.serial === selectedSerial)
    ?? authorised.find(device => device.serial === activeSerial)
    ?? authorised[0]
  useEffect(() => {
    if (!selected?.serial) return
    try {
      setPreviewOrientation(localStorage.getItem(`eon2:screen-orientation:${selected.serial}`) === 'landscape' ? 'landscape' : 'portrait')
    } catch { setPreviewOrientation('portrait') }
  }, [selected?.serial])
  const changePreviewOrientation = (value: 'portrait' | 'landscape') => {
    setPreviewOrientation(value)
    if (selected?.serial) {
      try { localStorage.setItem(`eon2:screen-orientation:${selected.serial}`, value) } catch { /* ephemeral preview choice */ }
    }
  }
  const activeName = readableModel(devices.find(device => device.serial === activeSerial))
  const active = status.state === 'starting' || status.state === 'running'
  const nativeAvailable = Boolean(window.kapanisDesktop)

  const syncLayout = useCallback((force = false): Promise<void> => {
    const owner = ownerRef.current
    if (!window.kapanisDesktop || !owner || currentSurface !== owner) return Promise.resolve()
    const slot = allowEmbeddedRef.current ? visibleScreenSlot(screenRef.current) : null
    const serialised = JSON.stringify(slot)
    if (!force && serialised === lastLayoutRef.current) return Promise.resolve()
    lastLayoutRef.current = serialised
    return sendLayout(owner, slot).catch(error => {
      // Allow the next resize/scroll/reconciliation tick to retry this slot.
      if (ownerRef.current === owner && lastLayoutRef.current === serialised) lastLayoutRef.current = null
      throw error
    })
  }, [])

  const updateStatus = useCallback((next: PhoneScreenStatus) => {
    statusRef.current = next
    allowEmbeddedRef.current = next.state !== 'running' || next.mode === 'embedded'
    if (aliveRef.current) setStatus(next)
    void syncLayout().catch(() => { /* Status polling will reconcile transient IPC failures. */ })
  }, [syncLayout])

  useEffect(() => {
    aliveRef.current = true
    let cancelled = false
    let count = 0
    const poll = async () => {
      if (!window.kapanisDesktop || document.hidden || busyRef.current) return
      const sequence = ++count
      try {
        const next = await desktopInvoke<PhoneScreenStatus>('eon2:scrcpy:status')
        if (!cancelled && sequence === count && !busyRef.current) updateStatus(next)
      } catch (cause) {
        if (!cancelled) setActionError(cause instanceof Error ? cause.message : 'Telefon ekranının durumu alınamadı.')
      } finally { if (!cancelled) setLoaded(true) }
    }

    let removeEvent: () => void = () => {}
    try {
      removeEvent = window.kapanisDesktop?.on('eon2:scrcpy:changed', payload => {
        if (!cancelled && payload && typeof payload === 'object' && 'state' in payload) {
          ++count
          updateStatus(payload as PhoneScreenStatus)
          setLoaded(true)
        }
      }) ?? removeEvent
    } catch { /* Older preloads may not expose this event. Polling remains available. */ }
    void poll()
    const timer = window.setInterval(() => { void poll() }, 1400)
    return () => { cancelled = true; aliveRef.current = false; ++count; removeEvent(); window.clearInterval(timer) }
  }, [updateStatus])

  useEffect(() => {
    const owner = Symbol('phone-screen-surface')
    ownerRef.current = owner
    currentSurface = owner
    let timeout: number | undefined
    let frame: number | undefined
    const schedule = () => {
      if (timeout !== undefined) return
      timeout = window.setTimeout(() => {
        timeout = undefined
        frame = window.requestAnimationFrame(() => {
          frame = undefined
          void syncLayout().catch(() => { /* A subsequent frame can retry the layout. */ })
        })
      }, 75)
    }

    const observer = typeof ResizeObserver !== 'undefined' ? new ResizeObserver(schedule) : null
    if (screenRef.current) observer?.observe(screenRef.current)
    observer?.observe(document.documentElement)
    window.addEventListener('resize', schedule)
    window.addEventListener('scroll', schedule, true)
    document.addEventListener('visibilitychange', schedule)
    const timer = window.setInterval(schedule, 1200)
    void syncLayout(true).catch(() => { /* Native bridge may not be ready in browser preview. */ })
    return () => {
      observer?.disconnect()
      window.removeEventListener('resize', schedule)
      window.removeEventListener('scroll', schedule, true)
      document.removeEventListener('visibilitychange', schedule)
      window.clearInterval(timer)
      if (timeout !== undefined) window.clearTimeout(timeout)
      if (frame !== undefined) window.cancelAnimationFrame(frame)
      if (currentSurface === owner) {
        currentSurface = null
        void sendLayout(owner, null, true).catch(() => undefined)
      }
      ownerRef.current = null
      lastLayoutRef.current = null
    }
  }, [syncLayout])

  const run = async (kind: Exclude<Action, null>, operation: () => Promise<PhoneScreenStatus>) => {
    if (busyRef.current) return
    busyRef.current = true
    setAction(kind)
    setActionError(null)
    try {
      const next = await operation()
      updateStatus(next)
    } catch (cause) {
      const error = cause instanceof Error ? cause.message : 'Telefon ekranı işlemi tamamlanamadı.'
      if (aliveRef.current) setActionError(error)
      allowEmbeddedRef.current = statusRef.current.state !== 'running' || statusRef.current.mode === 'embedded'
      void syncLayout(true).catch(() => undefined)
    } finally {
      busyRef.current = false
      if (aliveRef.current) setAction(null)
    }
  }

  const start = () => {
    if (!selected || active || !nativeAvailable) return
    void run('start', async () => {
      allowEmbeddedRef.current = true
      await syncLayout(true)
      const rect = screenRef.current?.getBoundingClientRect()
      const density = window.devicePixelRatio || 1
      const windowWidth = rect ? Math.round(rect.width * density) : undefined
      const windowHeight = rect ? Math.round(rect.height * density) : undefined
      return desktopInvoke<PhoneScreenStatus>('eon2:scrcpy:start', {
        serial: selected.serial, maxSize: 1920, maxFps: 60, bitRateMbps: 8,
        ...(windowWidth && windowWidth >= 48 && windowWidth <= 3840 ? { windowWidth } : {}),
        ...(windowHeight && windowHeight >= 48 && windowHeight <= 3840 ? { windowHeight } : {}),
      })
    })
  }
  const stop = () => { void run('stop', () => desktopInvoke<PhoneScreenStatus>('eon2:scrcpy:stop')) }
  const setMode = (mode: PhoneScreenMode) => {
    if (status.state !== 'running' || status.mode === mode) return
    void run('mode', async () => {
      if (mode === 'embedded') {
        allowEmbeddedRef.current = true
        await syncLayout(true)
      }
      return desktopInvoke<PhoneScreenStatus>('eon2:scrcpy:mode', mode)
    })
  }

  const stateText = !nativeAvailable ? 'Önizleme modu' : !loaded ? 'Bağlantı kontrol ediliyor' :
    status.state === 'starting' ? 'Ekran hazırlanıyor' : status.state === 'running' ? 'Canlı bağlantı' :
      status.state === 'error' ? 'Bağlantı hatası' : 'Bağlantı bekleniyor'
  const mode = status.state === 'running' ? status.mode : 'embedded'

  return <section className={`eon2-phone-surface ${compact ? 'is-compact' : ''} ${previewOrientation === 'landscape' ? 'is-landscape' : ''}`} aria-label="Telefon ekranı kontrolü" aria-busy={nativeAvailable && (!loaded || status.state === 'starting')}>
    {!minimal && <div className="eon2-phone-heading">
      <div className="eon2-phone-heading-icon" aria-hidden="true"><Smartphone size={19}/></div>
      <div className="eon2-phone-heading-copy"><span className="eon2-board-overline">ANDROID / SCREEN</span><h2>Telefon ekranı</h2></div>
      <span className={`eon2-phone-status ${status.state === 'running' ? 'is-live' : ''}`} role="status"><CircleDot size={12} aria-hidden="true"/>{stateText}</span>
    </div>}
    <div className="eon2-phone-body">
      <div className="eon2-phone-controls">
        <label htmlFor={compact ? 'eon2-phone-device-compact' : 'eon2-phone-device-main'} className="eon2-phone-label">Kontrol edilecek cihaz</label>
        <div className="eon2-phone-picker">
          <select id={compact ? 'eon2-phone-device-compact' : 'eon2-phone-device-main'} value={selected?.serial ?? ''} onChange={event => { setSelectedSerial(event.target.value); setActionError(null) }} disabled={!authorised.length || Boolean(action) || active}>
            {!authorised.length && <option value="">Yetkili USB cihazı bulunamadı</option>}
            {authorised.map(device => <option key={device.serial} value={device.serial}>{readableModel(device)} · {device.serial}</option>)}
          </select>
        </div>
        {active && <p className="eon2-phone-current"><CheckCircle2 size={14} aria-hidden="true"/> {activeName} {status.state === 'starting' ? 'bağlanıyor' : 'kontrol ediliyor'}</p>}
        <div className="eon2-phone-actions">
          {active ? <button type="button" className="eon2-button eon2-button--outline" disabled={Boolean(action)} onClick={stop}><Square size={14} aria-hidden="true"/> Oturumu bitir</button>
            : <button type="button" className="eon2-button eon2-button--primary" disabled={!selected || Boolean(action) || !nativeAvailable} onClick={start}>
              {action === 'start' ? <LoaderCircle size={15} className="eon2-phone-spin" aria-hidden="true"/> : <MonitorPlay size={15} aria-hidden="true"/>}{action === 'start' ? 'Başlatılıyor' : 'Ekranı aç'}
            </button>}
        </div>
        <div className="eon2-phone-mode-group" aria-label="Telefon ekranı görüntüleme modu">
          <span className="eon2-phone-label">Görüntüleme</span>
          <div className="eon2-segment eon2-phone-mode-switch" role="group" aria-label="Ekran görüntüleme modu">
            {MODES.map(({ id, label, icon: Icon }) => <button key={id} type="button" title={label} aria-pressed={status.state === 'running' && mode === id} className={status.state === 'running' && mode === id ? 'is-active' : ''} disabled={status.state !== 'running' || Boolean(action)} onClick={() => setMode(id)}><Icon size={14} aria-hidden="true"/><span>{label}</span></button>)}
          </div>
        </div>
        <div className="eon2-phone-orientation-group">
          <span className="eon2-phone-label">Önizleme yönü</span>
          <div className="eon2-segment eon2-phone-orientation-switch" role="group" aria-label="Telefon önizleme yönü">
            <button type="button" className={previewOrientation === 'portrait' ? 'is-active' : ''}
              aria-pressed={previewOrientation === 'portrait'} onClick={() => changePreviewOrientation('portrait')}>
              <Smartphone size={15} aria-hidden="true"/> Dikey
            </button>
            <button type="button" className={previewOrientation === 'landscape' ? 'is-active' : ''}
              aria-pressed={previewOrientation === 'landscape'} onClick={() => changePreviewOrientation('landscape')}>
              <Monitor size={15} aria-hidden="true"/> Yatay
            </button>
          </div>
          <small>Telefonu yataya çevirdiğinde görüntünün tamamını göstermek için Yatay'ı seç.</small>
        </div>
        {!minimal && <p className="eon2-phone-help"><PlugZap size={15} aria-hidden="true"/> Scrcpy kontrolü için USB hata ayıklama izni gerekir. Eşleştirilmiş Eon erişimi ayrı yönetilir.</p>}
        {(actionError || status.state === 'error') && <div className="eon2-phone-error" role="alert"><AlertCircle size={16} aria-hidden="true"/><span>{actionError || (status.state === 'error' ? status.message : '')}</span></div>}
        {!nativeAvailable && <p className="eon2-phone-info" role="status">Canlı kontrol Eon masaüstü uygulamasında açılır.</p>}
        {!authorised.length && nativeAvailable && <p className="eon2-phone-info" role="status">Telefonu USB ile bağlayıp Android'de bu bilgisayara izin ver.</p>}
      </div>
      <div className="eon2-phone-preview">
        <div className="eon2-phone-shell">
          <div className="eon2-phone-shell-top" aria-hidden="true"><span/></div>
          <div ref={screenRef} className="eon2-phone-viewport" aria-label="Canlı Android ekran alanı">
            <div className="eon2-phone-placeholder" aria-hidden="true">
              {status.state === 'starting' ? <LoaderCircle className="eon2-phone-spin" size={34}/>
                : status.state === 'running' && mode !== 'embedded' ? <PictureInPicture2 size={34}/>
                : status.state === 'running' ? <CircleDot size={34}/>
                : <Smartphone size={38}/>}
              <strong>{status.state === 'starting' ? 'Ekran hazırlanıyor' : status.state === 'running' && mode === 'window' ? 'Ayrı pencerede açık' : status.state === 'running' && mode === 'pip' ? 'PiP penceresinde açık' : status.state === 'running' ? 'Ekran bağlı' : 'Telefonun burada görünecek'}</strong>
              <small>{status.state === 'running' && mode !== 'embedded' ? 'Eon içinde görüntülemek için görünümü değiştir.' : status.state === 'running' ? 'Telefon ekranını fare ve klavyeyle kontrol edebilirsin.' : 'Cihazını seç ve ekranı aç.'}</small>
            </div>
          </div>
          <div className="eon2-phone-shell-bottom" aria-hidden="true"><span/></div>
        </div>
        <div className="eon2-phone-preview-caption"><span className={status.state === 'running' ? 'is-live' : ''}/><span>{status.state === 'running' ? `${mode === 'embedded' ? 'Eon içinde' : mode === 'pip' ? 'PiP' : 'Harici pencere'} · scrcpy` : 'USB üzerinden güvenli ekran kontrolü'}</span></div>
      </div>
    </div>
  </section>
}
