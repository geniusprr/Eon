import { customActionIcon } from './controls/actionIcons'
import type { ActionIconId } from '../../shared/eon-controls'
import { MediaPlayer } from './MediaPlayer'
import type { DeckMediaSample } from '../../shared/eon-deck-telemetry'
import { useCallback, useEffect, useRef, useState, type CSSProperties, type PointerEvent as ReactPointerEvent, type ReactNode } from 'react'
import {
  Activity, ArrowLeftRight, BarChart3, Check, ChevronDown, CircleHelp, Clock3, Command,
  Cpu, Grip, HardDrive, Headphones, LayoutDashboard, LayoutTemplate, Maximize2,
  MemoryStick, Minus, Monitor, MoreHorizontal, NotebookPen, Plus,
  RotateCcw, Save, Settings2, Smartphone, Trash2, Undo2,
  X,
} from 'lucide-react'
import type { IpcChannel } from '../../shared/contracts'
import { PhoneScreenSurface, type Device } from './PhoneScreenSurface'
import {
  addStudioKind, createStudioState, layoutForPreset, placeTile, readStudioState, removeStudioKind,
  studioColumns, studioKinds, studioPresets, tileMin,
  type StudioColumns, type StudioKind, type StudioPreset, type StudioState, type StudioTile,
} from './dashboardStudioLayout'
import './dashboard-studio.css'

type Section = 'dashboard' | 'notes' | 'devices' | 'automations' | 'transfers' | 'settings'
type Note = { id: string; title: string; content: string; updatedAt: number; unresolved?: boolean }
type SystemSnapshot = {
  hostname: string
  cpu: { usagePercent: number | null; logicalCores: number }
  memory: { totalBytes: number; usedBytes: number; usagePercent: number }
  disk?: { totalBytes: number; usedBytes: number; usagePercent: number }
  uptimeSeconds: number
}
type DeckKey = { id: string; name: string; kind: string; icon?: ActionIconId; available: boolean }
type Deck = {
  tools: Array<{ id: string; name: string; icon: string }>
  actions: DeckKey[]
  mediaAvailable: boolean
  gpu?: { usagePercent: number; temperatureC?: number | null } | null
  media?: DeckMediaSample | null
}
type Props = { snapshot: SystemSnapshot | null; notes: Note[]; devices: Device[]; now: Date; navigate: (page: Section) => void }

const labels: Record<StudioKind, { title: string; eyebrow: string; icon: typeof Monitor }> = {
  phone: { title: 'Telefon ekranı', eyebrow: 'ANDROID · LIVE', icon: Smartphone },
  clock: { title: 'Saat ve tarih', eyebrow: 'ZAMAN', icon: Clock3 },
  cpu: { title: 'İşlemci', eyebrow: 'SİSTEM', icon: Cpu },
  memory: { title: 'Bellek', eyebrow: 'SİSTEM', icon: MemoryStick },
  gpu: { title: 'Ekran kartı', eyebrow: 'SİSTEM', icon: Monitor },
  disk: { title: 'Disk', eyebrow: 'DEPOLAMA', icon: HardDrive },
  media: { title: 'Medya', eyebrow: 'ŞİMDİ ÇALIYOR', icon: Headphones },
  shortcuts: { title: 'PC kısayolları', eyebrow: 'HIZLI ERİŞİM', icon: Command },
  notes: { title: 'Notlar', eyebrow: 'EON NOTES', icon: NotebookPen },
  devices: { title: 'Bağlı cihazlar', eyebrow: 'BAĞLANTI', icon: Smartphone },
  uptime: { title: 'Çalışma süresi', eyebrow: 'SİSTEM', icon: Activity },
}
const keyIcons: Record<string, typeof Monitor> = {
  folder: HardDrive, file: HardDrive, terminal: Command, command: Command, chart: BarChart3,
  settings: Settings2, application: LayoutDashboard, lock: Monitor, shutdown: Monitor,
  restart: RotateCcw, cancel: RotateCcw,
}
const STORE_KEY = 'eon2:dashboard-studio:v2'
const GAP = 12
const ROW = 76

async function invoke<T>(channel: IpcChannel, value?: unknown): Promise<T> {
  if (!window.kapanisDesktop) throw new Error('Bu özellik Eon masaüstü uygulamasında kullanılabilir.')
  return window.kapanisDesktop.invoke(channel, value) as Promise<T>
}

function initialStudio(): StudioState {
  try { return readStudioState(JSON.parse(localStorage.getItem(STORE_KEY) || 'null')) }
  catch { return createStudioState() }
}
function widthColumns(width: number): StudioColumns {
  return width >= 1170 ? 12 : width >= 690 ? 8 : width >= 510 ? 6 : 4
}
function formatBytes(value: number) {
  return Number.isFinite(value) ? `${(value / (1024 ** 3)).toLocaleString('tr-TR', { maximumFractionDigits: 1 })} GB` : '—'
}
function formatUptime(seconds: number) {
  const days = Math.floor(seconds / 86400)
  const hours = Math.floor(seconds % 86400 / 3600)
  const mins = Math.floor(seconds % 3600 / 60)
  return days ? `${days} gün ${hours} saat` : hours ? `${hours} saat ${mins} dk` : `${mins} dk`
}
function Metric({ label, value, percentage, caption, accent = 'mint' }: {
  label: string; value: string; percentage?: number | null; caption: string; accent?: 'mint' | 'blue' | 'violet' | 'amber'
}) {
  const ratio = percentage == null || !Number.isFinite(percentage) ? null : Math.max(0, Math.min(100, percentage))
  return <div className={`eon-studio-metric tone-${accent}`}>
    <div className="eon-studio-metric-top"><span>{label}</span><strong>{value}</strong></div>
    <div className="eon-studio-meter" role="progressbar" aria-label={`${label} kullanım oranı`}
      aria-valuemin={0} aria-valuemax={100} aria-valuenow={ratio === null ? undefined : Math.round(ratio)}
      aria-valuetext={ratio === null ? 'Veri yok' : `%${Math.round(ratio)}`}>
      <span style={{ width: `${ratio ?? 0}%` }}/>
    </div>
    <small>{caption}</small>
  </div>
}

function StudioWidgetBody({ kind, snapshot, notes, devices, now, deck, busy, runCommand, mediaCommand, navigate }: {
  kind: StudioKind; snapshot: SystemSnapshot | null; notes: Note[]; devices: Device[]; now: Date
  deck: Deck | null; busy: boolean
  runCommand: (key: DeckKey, tool: boolean) => void
  mediaCommand: (id: string) => void
  navigate: Props['navigate']
}) {
  const keys: Array<DeckKey & { tool: boolean }> = [
    ...(deck?.tools || []).map(tool => ({ id: tool.id, name: tool.name, kind: tool.icon, available: true, tool: true })),
    ...(deck?.actions || []).map(action => ({ ...action, tool: false })),
  ]
  if (kind === 'phone') return <PhoneScreenSurface devices={devices} compact/>
  if (kind === 'clock') return <div className="eon-studio-clock">
    <time dateTime={now.toISOString()}>{now.toLocaleTimeString('tr-TR', { hour: '2-digit', minute: '2-digit' })}</time>
    <span>{now.toLocaleDateString('tr-TR', { weekday: 'long', month: 'long', day: 'numeric' })}</span>
  </div>
  if (kind === 'cpu') return <Metric label="CPU" value={snapshot?.cpu.usagePercent == null ? '—' : `%${Math.round(snapshot.cpu.usagePercent)}`}
    percentage={snapshot?.cpu.usagePercent} caption={snapshot ? `${snapshot.cpu.logicalCores} mantıksal çekirdek` : 'Sistem verisi bekleniyor'}/>
  if (kind === 'memory') return <Metric label="RAM" value={snapshot ? `%${Math.round(snapshot.memory.usagePercent)}` : '—'}
    percentage={snapshot?.memory.usagePercent} accent="violet"
    caption={snapshot ? `${formatBytes(snapshot.memory.usedBytes)} / ${formatBytes(snapshot.memory.totalBytes)}` : 'Sistem verisi bekleniyor'}/>
  if (kind === 'gpu') return <Metric label="GPU" value={deck?.gpu ? `%${Math.round(deck.gpu.usagePercent)}` : '—'}
    percentage={deck?.gpu?.usagePercent} accent="blue"
    caption={deck?.gpu?.temperatureC != null ? `Sıcaklık ${deck.gpu.temperatureC} °C` : 'GPU telemetrisi kullanılamıyor'}/>
  if (kind === 'disk') return <Metric label="Disk" value={snapshot?.disk ? `%${Math.round(snapshot.disk.usagePercent)}` : '—'}
    percentage={snapshot?.disk?.usagePercent} accent="amber"
    caption={snapshot?.disk ? `${formatBytes(snapshot.disk.usedBytes)} / ${formatBytes(snapshot.disk.totalBytes)}` : 'Disk telemetrisi bekleniyor'}/>
  if (kind === 'uptime') return <div className="eon-studio-stat">
    <Activity size={25}/><strong>{snapshot ? formatUptime(snapshot.uptimeSeconds) : '—'}</strong>
    <small>Windows açık kalma süresi</small>
  </div>
  if (kind === 'devices') {
    const connected = devices.filter(item => item.usb && item.state === 'device')
    return <div className="eon-studio-device">
      <strong>{connected.length}<span> cihaz</span></strong>
      <p>{connected.length ? connected.map(item => item.model || item.serial).join(', ') : 'USB ile cihaz bağlayabilirsin.'}</p>
      <button type="button" onClick={() => navigate('devices')}>Cihazları yönet <ChevronDown size={15}/></button>
    </div>
  }
  if (kind === 'notes') return <div className="eon-studio-notes">
    {notes.length ? notes.slice(0, 3).map(note => <button type="button" key={note.id} onClick={() => navigate('notes')}>
      <NotebookPen size={16}/><span><strong>{note.title || 'Başlıksız not'}</strong><small>{note.unresolved ? 'Sürüm çakışması' : (note.content?.replace(/\s+/g, ' ').slice(0, 90) || 'Boş not')}</small></span>
    </button>) : <div className="eon-studio-empty"><NotebookPen size={28}/><span>İlk notun için yer aç.</span></div>}
    <button type="button" className="eon-studio-inline-link" onClick={() => navigate('notes')}>Notları aç <ChevronDown size={14}/></button>
  </div>
  if (kind === 'media') return <MediaPlayer media={deck?.media} available={Boolean(deck?.mediaAvailable)} busy={busy} onCommand={mediaCommand}/>
  return <div className="eon-studio-shortcuts">
    {keys.length ? keys.slice(0, 8).map(key => {
      const Icon = customActionIcon(key.icon) ?? keyIcons[key.kind] ?? Command
      return <button key={key.id} type="button" disabled={!key.available || busy} title={key.name}
        onClick={() => runCommand(key, key.tool)}><Icon size={18}/><span>{key.name}</span></button>
    }) : <div className="eon-studio-empty"><Command size={28}/><span>Henüz PC kısayolu yok.</span></div>}
    <button type="button" className="eon-studio-inline-link" onClick={() => navigate('automations')}>Kısayolları yönet <ChevronDown size={14}/></button>
  </div>
}

type Gesture = { id: StudioKind; mode: 'drag' | 'resize'; pointer: number; startX: number; startY: number; tile: StudioTile; stepX: number; cols: StudioColumns }

export function DashboardStudio({ snapshot, notes, devices, now, navigate }: Props) {
  const [board, setBoard] = useState<StudioState>(initialStudio)
  const [columns, setColumns] = useState<StudioColumns>(12)
  const [editing, setEditing] = useState(false)
  const [previous, setPrevious] = useState<StudioState | null>(null)
  const [notice, setNotice] = useState('')
  const [deck, setDeck] = useState<Deck | null>(null)
  const [busy, setBusy] = useState(false)
  const [preview, setPreview] = useState<StudioTile | null>(null)
  const canvasRef = useRef<HTMLDivElement>(null)
  const stageRef = useRef<HTMLDivElement>(null)
  const gestureRef = useRef<Gesture | null>(null)
  const boardRef = useRef(board)
  const columnRef = useRef(columns)
  const previewRef = useRef<StudioTile | null>(null)
  const presetRef = useRef<HTMLDetailsElement>(null)
  const libraryRef = useRef<HTMLDetailsElement>(null)

  useEffect(() => { boardRef.current = board; localStorage.setItem(STORE_KEY, JSON.stringify(board)) }, [board])
  useEffect(() => { columnRef.current = columns }, [columns])
  useEffect(() => {
    if (!canvasRef.current) return
    const observer = new ResizeObserver(entries => {
      const width = entries[0]?.contentRect.width || canvasRef.current?.clientWidth || 0
      setColumns(widthColumns(width))
    })
    observer.observe(canvasRef.current)
    return () => observer.disconnect()
  }, [])
  useEffect(() => {
    let mounted = true
    const refresh = async () => {
      try { const data = await invoke<Deck>('eon2:deck:get'); if (mounted) setDeck(data) }
      catch { if (mounted) setDeck(null) }
    }
    void refresh()
    const interval = window.setInterval(() => { if (!document.hidden) void refresh() }, 4500)
    return () => { mounted = false; window.clearInterval(interval) }
  }, [])

  const commit = useCallback((next: StudioState, message: string) => {
    setPrevious(boardRef.current)
    boardRef.current = next
    setBoard(next)
    setNotice(message)
  }, [])
  const applyPreset = (preset: StudioPreset) => {
    commit(createStudioState(preset), `${studioPresets.find(item => item.id === preset)?.title} düzeni uygulandı.`)
    presetRef.current?.removeAttribute('open')
  }
  const updateTile = useCallback((tile: StudioTile, label: string) => {
    const current = boardRef.current
    const cols = columnRef.current
    const next: StudioState = { ...current, preset: 'custom', layouts: {
      ...current.layouts,
      [cols]: placeTile(current.layouts[cols], tile, cols),
    } }
    commit(next, label)
  }, [commit])
  const add = (kind: StudioKind) => {
    commit(addStudioKind(boardRef.current, kind), `${labels[kind].title} eklendi.`)
    libraryRef.current?.removeAttribute('open')
  }
  const remove = (kind: StudioKind) => commit(removeStudioKind(boardRef.current, kind), `${labels[kind].title} kaldırıldı; geri alabilirsin.`)
  const undo = () => {
    if (!previous) return
    const current = boardRef.current
    boardRef.current = previous
    setBoard(previous)
    setPrevious(current)
    setNotice('Önceki düzen geri yüklendi.')
  }

  const startGesture = (event: ReactPointerEvent<HTMLButtonElement>, tile: StudioTile, mode: 'drag' | 'resize') => {
    if (!editing || event.button !== 0 || !stageRef.current) return
    event.preventDefault()
    const rect = stageRef.current.getBoundingClientRect()
    gestureRef.current = {
      id: tile.id, mode, pointer: event.pointerId, startX: event.clientX, startY: event.clientY,
      tile, cols: columns, stepX: (rect.width - GAP * (columns - 1)) / columns + GAP,
    }
    setPreview(tile)
    previewRef.current = tile
    event.currentTarget.setPointerCapture(event.pointerId)
  }
  const moveGesture = (event: ReactPointerEvent<HTMLButtonElement>) => {
    const gesture = gestureRef.current
    if (!gesture || gesture.pointer !== event.pointerId) return
    const dx = Math.round((event.clientX - gesture.startX) / gesture.stepX)
    const dy = Math.round((event.clientY - gesture.startY) / (ROW + GAP))
    const tile = gesture.tile
    const min = tileMin(tile.id, gesture.cols)
    const candidate: StudioTile = gesture.mode === 'drag'
      ? { ...tile, x: Math.max(0, Math.min(gesture.cols - tile.w, tile.x + dx)), y: Math.max(0, Math.min(120, tile.y + dy)) }
      : { ...tile, w: Math.max(min.w, Math.min(gesture.cols - tile.x, tile.w + dx)), h: Math.max(min.h, Math.min(16, tile.h + dy)) }
    previewRef.current = candidate
    setPreview(candidate)
  }
  const stopGesture = (event: ReactPointerEvent<HTMLButtonElement>) => {
    const gesture = gestureRef.current
    if (!gesture || gesture.pointer !== event.pointerId) return
    gestureRef.current = null
    if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId)
    const target = previewRef.current
    previewRef.current = null
    setPreview(null)
    if (event.type !== 'pointercancel' && target && (target.x !== gesture.tile.x || target.y !== gesture.tile.y || target.w !== gesture.tile.w || target.h !== gesture.tile.h)) {
      updateTile(target, `${labels[target.id].title} ${gesture.mode === 'drag' ? 'taşındı' : 'yeniden boyutlandırıldı'}.`)
    }
  }
  const arrowKey = (event: React.KeyboardEvent<HTMLButtonElement>, tile: StudioTile, resize = false) => {
    const steps: Record<string, [number, number]> = {
      ArrowLeft: [-1, 0], ArrowRight: [1, 0], ArrowUp: [0, -1], ArrowDown: [0, 1],
    }
    const delta = steps[event.key]
    if (!delta) return
    event.preventDefault()
    const min = tileMin(tile.id, columns)
    const [dx, dy] = delta
    const result = resize || event.shiftKey
      ? { ...tile, w: Math.max(min.w, Math.min(columns - tile.x, tile.w + dx)), h: Math.max(min.h, Math.min(16, tile.h + dy)) }
      : { ...tile, x: Math.max(0, Math.min(columns - tile.w, tile.x + dx)), y: Math.max(0, tile.y + dy) }
    updateTile(result, `${labels[tile.id].title} güncellendi.`)
  }

  const doWork = async (channel: IpcChannel, payload: unknown, label: string) => {
    if (busy) return
    setBusy(true)
    try {
      await invoke(channel, payload)
      setNotice(`${label} komutu gönderildi.`)
    } catch (error) { setNotice(error instanceof Error ? error.message : 'İşlem başarısız.') }
    finally { setBusy(false) }
  }
  const runCommand = (item: DeckKey, tool: boolean) => {
    if (!item.available || busy) return
    if (['shutdown', 'restart', 'lock', 'cancel', 'command'].includes(item.kind) && !window.confirm(`“${item.name}” çalıştırılsın mı?`)) return
    void doWork(tool ? 'eon2:deck:execute' : 'eon2:actions:execute', { id: item.id }, item.name)
  }

  const tiles = board.layouts[columns]
  const activeIds = new Set(tiles.map(tile => tile.id))
  const heightRows = tiles.reduce((max, tile) => Math.max(max, tile.y + tile.h), 0)
  const selectedPreset = studioPresets.find(item => item.id === board.preset)
  return <section className="eon-studio" aria-label="Kişiselleştirilebilir dashboard">
    <div className="eon-studio-heading">
      <div className="eon-studio-heading-title">
        <span className="eon-studio-overline"><span className="eon-studio-dot"/> EON WORKSPACE <span className="eon-studio-heading-rule"/> CANLI PANEL</span>
        <h1>Çalışma alanın<span>.</span></h1>
        <p>Telefonun ve bilgisayarın, tek bir bakışta.</p>
      </div>
      <div className="eon-studio-toolbar">
        <details className="eon-studio-menu" ref={presetRef}>
          <summary><LayoutTemplate size={16}/><span>{selectedPreset?.title || 'Özel düzen'}</span><ChevronDown size={14}/></summary>
          <div className="eon-studio-dropdown eon-studio-preset-menu">
            <div className="eon-studio-dropdown-label">HAZIR YERLEŞİMLER</div>
            {studioPresets.map(item => <button type="button" key={item.id} onClick={() => applyPreset(item.id)} className={board.preset === item.id ? 'is-selected' : ''}>
              <LayoutDashboard size={18}/><span><strong>{item.title}</strong><small>{item.description}</small></span>{board.preset === item.id && <Check size={16}/>}
            </button>)}
          </div>
        </details>
        <details className="eon-studio-menu" ref={libraryRef}>
          <summary><Plus size={16}/><span>Kart ekle</span></summary>
          <div className="eon-studio-dropdown eon-studio-library">
            <div className="eon-studio-dropdown-label">WIDGET KÜTÜPHANESİ</div>
            {studioKinds.map(kind => {
              const Icon = labels[kind].icon
              return <button type="button" key={kind} disabled={activeIds.has(kind)} onClick={() => add(kind)}>
                <Icon size={17}/><span>{labels[kind].title}</span>{activeIds.has(kind) ? <Check size={15}/> : <Plus size={15}/>}
              </button>
            })}
          </div>
        </details>
        <button type="button" className={`eon-studio-edit ${editing ? 'is-editing' : ''}`} aria-pressed={editing} onClick={() => { setEditing(current => !current); setPreview(null); gestureRef.current = null }}>
          {editing ? <Check size={16}/> : <Grip size={16}/>}<span>{editing ? 'Düzenlemeyi bitir' : 'Düzeni düzenle'}</span>
        </button>
        {previous && <button type="button" className="eon-studio-icon-button" aria-label="Son değişikliği geri al" title="Son değişikliği geri al" onClick={undo}><Undo2 size={17}/></button>}
      </div>
    </div>
    {editing && <div className="eon-studio-instructions"><Maximize2 size={15}/> Kartları tutup sürükle; sağ alt köşeden boyutlandır. Ok tuşları taşır, Shift + ok tuşları boyutlandırır.<button type="button" onClick={() => setEditing(false)} aria-label="Düzenleme yardımını kapat"><X size={15}/></button></div>}
    <div className="eon-studio-canvas" ref={canvasRef}>
      <div className="eon-studio-grid" ref={stageRef} data-columns={columns} style={{ '--studio-columns': columns, minHeight: heightRows ? heightRows * (ROW + GAP) - GAP : ROW } as CSSProperties}>
        {tiles.map(tile => {
          const Icon = labels[tile.id].icon
          const isActive = preview?.id === tile.id
          return <article key={tile.id} data-studio-widget={tile.id} className={`eon-studio-tile eon-studio-tile--${tile.id} ${editing ? 'is-editable' : ''} ${isActive ? 'is-moving' : ''}`}
            style={{ gridColumn: `${tile.x + 1} / span ${tile.w}`, gridRow: `${tile.y + 1} / span ${tile.h}` }}>
            <header className="eon-studio-tile-header">
              <span className="eon-studio-tile-icon"><Icon size={16} strokeWidth={1.8}/></span>
              <span className="eon-studio-tile-title"><strong>{labels[tile.id].title}</strong><small>{labels[tile.id].eyebrow}</small></span>
              {editing ? <span className="eon-studio-tile-actions">
                <button type="button" aria-label={`${labels[tile.id].title} kartını taşı; ok tuşlarıyla da taşıyabilirsin`} title="Taşı" className="eon-studio-handle" onPointerDown={event => startGesture(event, tile, 'drag')}
                  onPointerMove={moveGesture} onPointerUp={stopGesture} onPointerCancel={stopGesture} onKeyDown={event => arrowKey(event, tile)}><Grip size={17}/></button>
                <button type="button" aria-label={`${labels[tile.id].title} kartını kaldır`} title="Kaldır" onClick={() => remove(tile.id)}><X size={16}/></button>
              </span> : tile.id === 'phone' ? <span className="eon-studio-tile-live"><span/> USB / scrcpy</span> : null}
            </header>
            <div className="eon-studio-tile-content">
              <StudioWidgetBody kind={tile.id} snapshot={snapshot} notes={notes} devices={devices} now={now} deck={deck}
                busy={busy} runCommand={runCommand} mediaCommand={id => void doWork('eon2:deck:execute', { id }, 'Medya')} navigate={navigate}/>
            </div>
            {editing && <button type="button" className="eon-studio-resize-handle" title="Boyutlandır" aria-label={`${labels[tile.id].title} kartının boyutunu değiştir; ok tuşlarıyla da değiştirebilirsin`}
              onPointerDown={event => startGesture(event, tile, 'resize')} onPointerMove={moveGesture} onPointerUp={stopGesture} onPointerCancel={stopGesture}
              onKeyDown={event => arrowKey(event, tile, true)}><Maximize2 size={15}/></button>}
          </article>
        })}
        {preview && <div className="eon-studio-drop-preview" aria-hidden="true" style={{
          gridColumn: `${preview.x + 1} / span ${preview.w}`, gridRow: `${preview.y + 1} / span ${preview.h}`,
        }}/>}
      </div>
    </div>
    <footer className="eon-studio-footer"><div role="status" aria-live="polite"><span className="eon-studio-footer-dot"/>{notice || `${tiles.length} widget · Düzen otomatik kaydediliyor`}</div><span><Save size={13}/> Bu pencere genişliği için kayıtlı</span></footer>
  </section>
}
