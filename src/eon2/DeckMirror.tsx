import { customActionIcon } from './controls/actionIcons'
import { isTimedPowerAction, type ActionIconId } from '../../shared/eon-controls'
import { usePowerCountdown } from './controls/usePowerCountdown'
import { MediaPlayer } from './MediaPlayer'
import type { DeckMediaSample } from '../../shared/eon-deck-telemetry'
import { useCallback, useEffect, useRef, useState, type PointerEvent as ReactPointerEvent } from 'react'
import {
  Grip, ArrowDown, ArrowLeft, ArrowRight, ArrowUp, ChevronDown, Command,
  ChartNoAxesColumn, ExternalLink, Folder, LayoutTemplate, LockKeyhole, Monitor,
  Plus, Power, RotateCcw, Save, Settings2, Square, Terminal, TimerOff, X,
} from 'lucide-react'
import type { IpcChannel } from '../../shared/contracts'
import {
  DECK_COLUMNS, DECK_PRESETS, DECK_ROWS,
  clampDeckTile, deckPreset, defaultDeckLayout, patchDeckTile, moveDeckTile, resizeDeckTile, validateDeckLayout,
  type DeckPage, type DeckLayout, type DeckTile, type DeckTileId, type DeckPreset, type DeckEdge,
} from './deckMirrorLayout'
import './deck-mirror.css'

type Section = 'dashboard' | 'notes' | 'devices' | 'automations' | 'transfers' | 'settings'
type SystemSnapshot = {
  hostname: string; cpu: { usagePercent: number | null; logicalCores: number };
  memory: { usagePercent: number }; disk?: { usagePercent: number };
}
type DeckKey = { id: string; name: string; kind: string; icon?: ActionIconId; available: boolean; remoteEnabled?: boolean;
  tool?: boolean; delaySeconds?: number; activeUntil?: number }
type DeckData = {
  tools: Array<{ id: string; name: string; icon: string }>
  actions: DeckKey[]
  mediaAvailable: boolean
  media?: DeckMediaSample | null
  gpu?: { usagePercent: number; temperatureC?: number | null } | null
}
type Props = {
  snapshot: SystemSnapshot | null; now: Date;
  devices: Array<{ state: string; usb: boolean; model: string | null; serial: string }>;
  navigate: (page: Section) => void
}
type Gesture = { pointerId: number; id: DeckTileId; mode: 'move' | 'resize'; startX: number; startY: number; tile: DeckTile; cellX: number; cellY: number; edge?: DeckEdge; moved: boolean; quickIndex?: number }

const uiNames: Record<DeckTileId, string> = {
  clock: 'Saat', cpu: 'CPU', gpu: 'GPU', ram: 'RAM', disk: 'Disk', media: 'Medya', shortcuts: 'Hızlı erişim',
}
const toolIcons: Record<string, typeof Command> = {
  folder: Folder, file: Folder, terminal: Terminal, command: Terminal, chart: ChartNoAxesColumn,
  settings: Settings2, application: ExternalLink, lock: LockKeyhole, shutdown: Power, restart: RotateCcw, cancel: TimerOff,
}
const keyTones: Record<string, string> = {
  folder: 'amber', file: 'amber', terminal: 'violet', command: 'violet', chart: 'mint', settings: 'muted',
  lock: 'coral', shutdown: 'coral', restart: 'coral', cancel: 'coral',
}

async function desktopInvoke<T>(channel: IpcChannel, data?: unknown): Promise<T> {
  if (!window.kapanisDesktop) throw new Error('Eon masaüstü bağlantısı bulunamadı.')
  return window.kapanisDesktop.invoke(channel, data) as Promise<T>
}
function rounded(value: number | null | undefined): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? Math.min(100, Math.max(0, Math.round(value))) : null
}
function Clock({ now }: { now: Date }) {
  return <div className="eon-mirror-clock">
    <span>BUGÜN / ÇALIŞMA ALANI</span>
    <time dateTime={now.toISOString()}>{now.toLocaleTimeString('tr-TR', { hour: '2-digit', minute: '2-digit' })}</time>
    <small>{now.toLocaleDateString('tr-TR', { day: 'numeric', month: 'long', weekday: 'long' })}</small>
  </div>
}
function CircleGauge({ label, percent, tone, detail }: { label: string; percent: number | null; tone: string; detail?: string }) {
  const val = rounded(percent)
  return <div className={`eon-mirror-gauge tone-${tone}`}>
    <header><strong>{label}</strong><span/></header>
    <div className="eon-mirror-ring" role="progressbar" aria-valuemin={0} aria-valuemax={100}
      aria-valuenow={val ?? undefined} aria-valuetext={val === null ? 'Veri yok' : `%${val}`} aria-label={`${label} kullanımı`}>
      <svg viewBox="0 0 100 100" aria-hidden="true">
        <circle className="ring-track" cx="50" cy="50" r="40"/>
        <circle className="ring-value" cx="50" cy="50" r="40" strokeDasharray={`${val === null ? 0 : val * 2.513274} 251.3274`}/>
      </svg>
      <b>{val === null ? '—' : `${val}%`}</b>
    </div>
    {detail && <small>{detail}</small>}
  </div>
}
function MirrorShortcut({ item, busy, hideName, onClick, quickIndex, phoneTile = false }: {
  item: DeckKey; busy: boolean; hideName: boolean; onClick: () => void; quickIndex?: number; phoneTile?: boolean
}) {
  const locked = phoneTile && (!item.available || item.remoteEnabled === false)
  const countdown = usePowerCountdown(locked ? undefined : item.activeUntil)
  const Icon = countdown ? Square : customActionIcon(item.icon) ?? toolIcons[item.kind] ?? Command
  const label = countdown ? `${item.name} · Durdur` : item.name
  const tone = locked ? 'muted' : countdown ? 'mint' : keyTones[item.kind] ?? 'blue'
  return <button type="button" disabled={busy || (!phoneTile && !item.available)} data-quick-index={quickIndex}
    className={countdown ? 'eon-mirror-shortcut-active' : undefined} data-tone={phoneTile ? tone : undefined}
    data-locked={locked || undefined} data-icon-only={hideName && !countdown || undefined}
    title={label} aria-label={locked ? `${label} · İzin gerekli` : label} onClick={onClick}>
    <Icon className="eon-mirror-key-icon" aria-hidden="true" size={22}/>
    {countdown ? <span role="timer">{countdown}</span> : !hideName && <span>{item.name}</span>}
    {locked && <LockKeyhole className="eon-mirror-key-lock" aria-hidden="true"/>}
  </button>
}

function MirrorContent({ id, snapshot, data, now, mediaCommand, command, busy, paired, quickIds, hideShortcutNames }: {
  id: DeckTileId; snapshot: SystemSnapshot | null; data: DeckData | null; now: Date;
  mediaCommand: (id: string) => void; command: (key: DeckKey & { tool?: boolean }) => void; busy: boolean; paired: boolean;
  quickIds: string[] | null; hideShortcutNames: boolean
}) {
  if (id === 'clock') return <Clock now={now}/>
  if (id === 'cpu') return <CircleGauge label="CPU" percent={snapshot?.cpu.usagePercent ?? null} tone="mint"/>
  if (id === 'gpu') return <CircleGauge label={data?.gpu?.temperatureC == null ? 'GPU' : `GPU ${data.gpu.temperatureC}°`}
    percent={data?.gpu?.usagePercent ?? null} tone="blue"/>
  if (id === 'ram') return <CircleGauge label="RAM" percent={snapshot?.memory.usagePercent ?? null} tone="violet"/>
  if (id === 'disk') return <CircleGauge label="DİSK" percent={snapshot?.disk?.usagePercent ?? null} tone="amber"/>
  if (id === 'media') return <MediaPlayer media={data?.media} available={Boolean(data?.mediaAvailable)} busy={busy} onCommand={mediaCommand}/>
  const keys: Array<DeckKey & { tool?: boolean }> = [
    ...(data?.tools ?? []).map(tool => ({ id: tool.id, name: tool.name, kind: tool.icon, available: true, tool: true })),
    ...(data?.actions ?? []),
  ]
  const selected = quickIds === null ? keys.slice(0, 6) : quickIds
    .map(identity => keys.find(item => `${item.tool ? 'tool' : 'action'}:${item.id}` === identity))
    .filter((item): item is DeckKey & { tool?: boolean } => Boolean(item))
  return <div className="eon-mirror-shortcuts">
    {selected.map((key, index) => <MirrorShortcut key={`${key.tool ? 'tool' : 'action'}:${key.id}`}
      item={key} busy={busy} quickIndex={index} hideName={hideShortcutNames} onClick={() => command(key)}/>)}
    {selected.length === 0 && <div className="eon-mirror-no-keys"><Command size={20}/><small>{quickIds?.length === 0 ? 'Hızlı kısayol seçilmedi' : paired ? 'Kısayollar yükleniyor' : 'PC bağlantısı bekleniyor'}</small></div>}
  </div>
}

export function DeckMirror({ snapshot, devices, now, navigate }: Props) {
  const [serverLayout, setServerLayout] = useState<DeckLayout>(defaultDeckLayout)
  const [selectedPage, setSelectedPage] = useState('panel')
  const [denseKeys, setDenseKeys] = useState(false)
  const [naming, setNaming] = useState<'add' | 'copy' | 'rename' | null>(null)
  const [pageName, setPageName] = useState('')
  const [draft, setDraft] = useState<DeckTile[] | null>(null)
  const [draftQuickIds, setDraftQuickIds] = useState<string[] | null>(null)
  const [draftHideShortcutNames, setDraftHideShortcutNames] = useState(false)
  const [editingQuick, setEditingQuick] = useState(false)
  const [layoutReady, setLayoutReady] = useState(false)
  const [syncError, setSyncError] = useState('')
  const [message, setMessage] = useState('')
  const [deck, setDeck] = useState<DeckData | null>(null)
  const [editMode, setEditMode] = useState(false)
  const [saving, setSaving] = useState(false)
  const [busy, setBusy] = useState(false)
  const [conflict, setConflict] = useState<DeckLayout | null>(null)
  const [preview, setPreview] = useState<DeckTile | null>(null)
  const [contextMenu, setContextMenu] = useState<{ x: number; y: number; tile?: DeckTile } | null>(null)
  const contextRef = useRef<HTMLDivElement>(null)
  const suppressClick = useRef(false)
  const gesture = useRef<Gesture | null>(null)
  const previewRef = useRef<DeckTile | null>(null)
  const layoutRef = useRef(serverLayout)
  const draftRef = useRef<DeckTile[] | null>(draft)
  const editorBaseRevision = useRef<number | null>(null)
  const editorBase = useRef<{ widgets: DeckTile[]; quickIds: string[] | null; hideShortcutNames: boolean } | null>(null)
  const gridRef = useRef<HTMLDivElement>(null)
  const menuRef = useRef<HTMLDetailsElement>(null)
  const deckRequest = useRef(0)

  useEffect(() => {
    if (!contextMenu) return
    const dismiss = (event: PointerEvent) => {
      if (!contextRef.current?.contains(event.target as Node)) setContextMenu(null)
    }
    const escape = (event: KeyboardEvent) => { if (event.key === 'Escape') setContextMenu(null) }
    document.addEventListener('pointerdown', dismiss)
    document.addEventListener('keydown', escape)
    contextRef.current?.querySelector<HTMLButtonElement>('button')?.focus()
    return () => { document.removeEventListener('pointerdown', dismiss); document.removeEventListener('keydown', escape) }
  }, [contextMenu])
  useEffect(() => { layoutRef.current = serverLayout }, [serverLayout])
  useEffect(() => { draftRef.current = draft }, [draft])
  const acceptLayout = useCallback((value: DeckLayout): DeckLayout => {
    const current = layoutRef.current
    if (value.revision < current.revision ||
      (value.revision === current.revision && value.updatedAt === current.updatedAt)) return current
    layoutRef.current = value
    setServerLayout(value)
    return value
  }, [])
  const loadLayout = useCallback(async () => {
    const response = await desktopInvoke<unknown>('eon2:deck:layout:get')
    const value = validateDeckLayout(response)
    if (!value) throw new Error('Bilgisayardaki Deck düzeni geçersiz.')
    const accepted = acceptLayout(value)
    setLayoutReady(true)
    setSyncError('')
    return accepted
  }, [acceptLayout])
  useEffect(() => {
    let active = true
    const refresh = async () => {
      try {
        const response = await desktopInvoke<unknown>('eon2:deck:layout:get')
        const value = validateDeckLayout(response)
        if (!value) throw new Error('Geçersiz Deck düzeni')
        if (!active) return
        const accepted = acceptLayout(value)
        if (editorBaseRevision.current !== null && accepted.revision > editorBaseRevision.current) {
          setConflict(accepted)
        }
        setLayoutReady(true); setSyncError('')
      } catch (error) {
        if (active) setSyncError(error instanceof Error ? error.message : 'Deck düzeni okunamadı.')
      }
    }
    void refresh()
    const id = window.setInterval(() => { if (!document.hidden) void refresh() }, 2800)
    return () => { active = false; window.clearInterval(id) }
  }, [acceptLayout])
  const refreshDeck = useCallback(async () => {
    const request = ++deckRequest.current
    try {
      const data = await desktopInvoke<DeckData>('eon2:deck:get')
      if (request === deckRequest.current) setDeck(data)
    } catch {
      if (request === deckRequest.current) setDeck(null)
    }
  }, [])
  useEffect(() => {
    void refreshDeck()
    const id = window.setInterval(() => { if (!document.hidden) void refreshDeck() }, 3500)
    return () => { ++deckRequest.current; window.clearInterval(id) }
  }, [refreshDeck])
  const connected = devices.filter(device => device.usb && device.state === 'device').length
  const pages = serverLayout.pages ?? []
  const currentPage = pages.find(page => page.id === selectedPage)
  const pageWidgets = currentPage?.widgets ?? serverLayout.widgets
  const pageQuickIds = currentPage ? currentPage.quickIds : serverLayout.quickIds ?? null
  const isKeys = selectedPage.startsWith('keys:')
  const allKeys: DeckKey[] = [
    ...(deck?.tools ?? []).map(tool => ({ id: tool.id, name: tool.name, kind: tool.icon, available: true, tool: true })),
    ...(deck?.actions ?? []),
  ]
  const keysPerPage = denseKeys ? 15 : 12
  const keyPageCount = Math.max(1, Math.ceil(allKeys.length / keysPerPage))
  const keyPage = isKeys ? Math.min(Number(selectedPage.slice(5)), keyPageCount - 1) : 0
  const pageKeys = allKeys.slice(keyPage * keysPerPage, (keyPage + 1) * keysPerPage)
  useEffect(() => {
    if (isKeys && deck && selectedPage !== `keys:${keyPage}`) setSelectedPage(`keys:${keyPage}`)
    else if (!isKeys && selectedPage !== 'panel' && !pages.some(page => page.id === selectedPage) && !editMode) setSelectedPage('panel')
  }, [deck, pages, selectedPage, editMode, isKeys, keyPage])
  const activeTiles = draft ?? pageWidgets
  const activeQuickIds = draft ? draftQuickIds : pageQuickIds
  const hideShortcutNames = draft ? draftHideShortcutNames : serverLayout.hideShortcutNames ?? false
  const changed = Boolean(draft && editorBase.current && (
    draftHideShortcutNames !== editorBase.current.hideShortcutNames ||
    JSON.stringify(draft) !== JSON.stringify(editorBase.current.widgets) ||
    JSON.stringify(draftQuickIds) !== JSON.stringify(editorBase.current.quickIds)))
  const update = (next: DeckTile[]) => {
    draftRef.current = next
    setDraft(next)
    setMessage('Değişiklikler hazır. Telefona uygulamak için Kaydet.')
  }
  const patch = (next: DeckTile, moving = false): boolean => {
    const changed = (moving ? moveDeckTile : patchDeckTile)(draftRef.current ?? (layoutRef.current.pages?.find(page => page.id === selectedPage)?.widgets ?? layoutRef.current.widgets), next)
    if (!changed) { setMessage('Kartlar çakışıyor veya alan yetersiz. Başka bir konum dene.'); return false }
    update(changed)
    return true
  }
  const openEditor = () => {
    if (draftRef.current) return
    setEditMode(true)
    editorBaseRevision.current = serverLayout.revision
    editorBase.current = { widgets: pageWidgets.map(tile => ({ ...tile })),
      quickIds: pageQuickIds?.slice() ?? null, hideShortcutNames: serverLayout.hideShortcutNames ?? false }
    setDraft(pageWidgets.map(tile => ({ ...tile })))
    draftRef.current = pageWidgets.map(tile => ({ ...tile }))
    setDraftQuickIds(pageQuickIds?.slice() ?? null)
    setDraftHideShortcutNames(serverLayout.hideShortcutNames ?? false)
    setMessage('Kartları sürükle veya köşelerinden boyutlandır. Değişiklikleri kaydettiğinde telefonda da uygulanır.')
  }
  const closeEditor = () => {
    if (changed && !window.confirm('Kaydedilmemiş Deck değişikliklerini iptal edelim mi?')) return
    setEditMode(false); editorBaseRevision.current = null; editorBase.current = null; setDraft(null); draftRef.current = null; setDraftQuickIds(null)
    setEditingQuick(false); setPreview(null); setConflict(null); setMessage('')
  }
  const save = async (forceLatest = false) => {
    const widgets = draftRef.current
    if (!widgets || saving) return
    setSaving(true)
    try {
      const revision = forceLatest && conflict ? conflict.revision : editorBaseRevision.current ?? serverLayout.revision
      const source = forceLatest && conflict ? conflict : serverLayout
      const quickChanged = JSON.stringify(draftQuickIds) !== JSON.stringify(editorBase.current?.quickIds ?? null)
      const namesChanged = draftHideShortcutNames !== (editorBase.current?.hideShortcutNames ?? false)
      const otherChanges = { ...(namesChanged ? { hideShortcutNames: draftHideShortcutNames } : {}) }
      if (selectedPage !== 'panel' && !source.pages?.some(page => page.id === selectedPage)) throw new Error('Bu ekran başka cihazda silinmiş. Son düzeni al.')
      const response = await desktopInvoke<unknown>('eon2:deck:layout:set', selectedPage === 'panel'
        ? { baseRevision: revision, widgets, ...otherChanges, ...(quickChanged ? { quickIds: draftQuickIds } : {}) }
        : { baseRevision: revision, widgets: source.widgets, ...otherChanges,
          pages: source.pages?.map(page => page.id === selectedPage ? { ...page, widgets,
            ...(quickChanged ? { quickIds: draftQuickIds } : {}) } : page) })
      if (response && typeof response === 'object' && 'error' in response &&
        (response as { error: unknown }).error === 'deck-layout-conflict') {
        const latest = validateDeckLayout('layout' in response ? response.layout : null)
        if (latest) { acceptLayout(latest); setConflict(latest) }
        setMessage('Telefon veya bilgisayar Deck düzenini değiştirmiş. Çakışmayı çözmen gerekiyor.')
        return
      }
      const data = validateDeckLayout(response)
      if (!data) throw new Error('Sunucunun düzen yanıtı geçersiz.')
      acceptLayout(data)
      setDraft(null); draftRef.current = null; editorBaseRevision.current = null; editorBase.current = null; setDraftQuickIds(null); setConflict(null); setEditingQuick(false); setEditMode(false)
      setMessage('Deck düzeni kaydedildi. Bağlı telefonda otomatik eşitlenir.')
      setSyncError('')
    } catch (error) {
      const reason = error instanceof Error ? error.message : 'Kaydetme başarısız.'
      try {
        const latest = await loadLayout()
        if (latest.revision > (editorBaseRevision.current ?? serverLayout.revision)) {
          setConflict(latest)
          setMessage('Telefon veya bilgisayar Deck düzenini değiştirmiş. Çakışmayı çözmen gerekiyor.')
        } else setSyncError(reason)
      } catch { setSyncError(reason) }
    } finally { setSaving(false) }
  }
  const savePages = async (next: DeckPage[], select = selectedPage) => {
    if (saving || editMode) return
    setSaving(true)
    try {
      const response = await desktopInvoke<unknown>('eon2:deck:layout:set', {
        baseRevision: serverLayout.revision, widgets: serverLayout.widgets, pages: next,
      })
      const value = validateDeckLayout(response)
      if (!value) throw new Error('Ekran listesi değişmiş olabilir. Yenileyip tekrar dene.')
      acceptLayout(value); setSelectedPage(select); setSyncError(''); setMessage('Ekranlar kaydedildi; telefonda otomatik eşitlenir.')
    } catch (error) { setSyncError(error instanceof Error ? error.message : 'Ekran kaydedilemedi.') }
    finally { setSaving(false) }
  }
  const addPage = (duplicate = false) => {
    setPageName(duplicate ? `${currentPage?.name ?? 'Deck'} kopyası` : `Ekran ${pages.length + 1}`)
    setNaming(duplicate ? 'copy' : 'add')
  }
  const submitName = () => {
    const name = pageName.trim()
    if (!name || name.length > 80) return
    if (naming === 'rename') {
      void savePages(pages.map(page => page.id === selectedPage ? { ...page, name } : page))
    } else {
      const id = crypto.randomUUID()
      void savePages([...pages, { id, name, widgets: structuredClone(naming === 'copy' ? pageWidgets : deckPreset('balanced')), quickIds: naming === 'copy' ? pageQuickIds?.slice() ?? null : null }], id)
    }
    setNaming(null)
  }
  const preset = (value: DeckPreset) => {
    update(deckPreset(value))
    menuRef.current?.removeAttribute('open')
    setMessage(`${DECK_PRESETS.find(item => item.id === value)?.name} düzeni seçildi. Kaydettiğinde telefonda uygulanır.`)
  }
  const startGesture = (event: ReactPointerEvent<HTMLDivElement>, tile: DeckTile, mode: 'move' | 'resize', edge?: DeckEdge) => {
    if (!gridRef.current || !layoutReady || saving || event.button !== 0 || (event.target as Element).closest('input, textarea, select')) return
    setContextMenu(null)
    const pointerTarget = event.target as Element
    pointerTarget.setPointerCapture(event.pointerId)
    const rect = gridRef.current.getBoundingClientRect()
    gesture.current = { pointerId: event.pointerId, id: tile.id, mode, startX: event.clientX, startY: event.clientY,
      tile, cellX: (rect.width - parseFloat(getComputedStyle(gridRef.current).paddingLeft) * 2) / DECK_COLUMNS,
      cellY: rect.height / DECK_ROWS, edge, moved: false,
      quickIndex: mode === 'move' ? Number((event.target as Element).closest<HTMLElement>('[data-quick-index]')?.dataset.quickIndex ?? NaN) : undefined }
  }
  const moveGesture = (event: ReactPointerEvent<HTMLDivElement>) => {
    const g = gesture.current
    if (!g || g.pointerId !== event.pointerId) return
    if (!g.moved) {
      if (Math.hypot(event.clientX - g.startX, event.clientY - g.startY) < 5) return
      g.moved = true
      suppressClick.current = true
      openEditor()
    }
    if (Number.isFinite(g.quickIndex)) return
    const deltaX = Math.round((event.clientX - g.startX) / g.cellX)
    const deltaY = Math.round((event.clientY - g.startY) / g.cellY)
    const tile = g.mode === 'move'
      ? clampDeckTile(g.tile, { x: g.tile.x + deltaX, y: g.tile.y + deltaY })
      : resizeDeckTile(g.tile, g.edge ?? 'se', deltaX, deltaY)
    setPreview(tile); previewRef.current = tile
  }
  const finishGesture = (event: ReactPointerEvent<HTMLDivElement>) => {
    const g = gesture.current
    if (!g || g.pointerId !== event.pointerId) return
    gesture.current = null
    const captureTarget = event.target as Element
    if (captureTarget.hasPointerCapture(event.pointerId)) captureTarget.releasePointerCapture(event.pointerId)
    const candidate = previewRef.current
    previewRef.current = null; setPreview(null)
    window.setTimeout(() => { suppressClick.current = false }, 0)
    if (event.type === 'pointercancel' || !g.moved) return
    if (Number.isFinite(g.quickIndex)) {
      const target = document.elementFromPoint(event.clientX, event.clientY)?.closest<HTMLElement>('[data-quick-index]')
      const to = Number(target?.dataset.quickIndex ?? NaN)
      if (Number.isFinite(to) && to !== g.quickIndex) {
        const keys = [...(deck?.tools ?? []).map(key => `tool:${key.id}`), ...(deck?.actions ?? []).map(key => `action:${key.id}`)]
        const ids = [...(activeQuickIds ?? keys.slice(0, 6))]
        ids.splice(to, 0, ids.splice(g.quickIndex!, 1)[0])
        setDraftQuickIds(ids)
      }
      return
    }
    if (!candidate) return
    if (candidate.x !== g.tile.x || candidate.y !== g.tile.y || candidate.w !== g.tile.w || candidate.h !== g.tile.h) patch(candidate, g.mode === 'move')
  }
  const keyboardMove = (event: React.KeyboardEvent<HTMLDivElement>, tile: DeckTile, resizing = false) => {
    const motions: Record<string, [number, number]> = { ArrowLeft: [-1, 0], ArrowRight: [1, 0], ArrowUp: [0, -1], ArrowDown: [0, 1] }
    const direction = motions[event.key]
    if (!direction || saving || !layoutReady) return
    event.preventDefault()
    openEditor()
    const [dx, dy] = direction
    patch(clampDeckTile(tile, resizing || event.shiftKey
      ? { w: tile.w + dx, h: tile.h + dy } : { x: tile.x + dx, y: tile.y + dy }), !(resizing || event.shiftKey))
  }
  const run = async (channel: IpcChannel, payload: unknown, title: string) => {
    if (busy) return
    setBusy(true)
    try {
      await desktopInvoke(channel, payload)
      if (channel === 'eon2:actions:execute') await refreshDeck()
      setMessage(`${title} · Komut gönderildi`)
    }
    catch (error) { setMessage(error instanceof Error ? error.message : 'Komut çalıştırılamadı.') }
    finally { setBusy(false) }
  }
  const runKey = (key: DeckKey) => {
    if (!key.available || busy) return
    if (!isTimedPowerAction(key.kind, key.delaySeconds) && !(key.activeUntil && key.activeUntil > Date.now()) &&
      ['lock', 'shutdown', 'restart', 'cancel', 'command'].includes(key.kind) &&
      !window.confirm(`“${key.name}” bilgisayarında çalıştırılsın mı?`)) return
    void run(key.tool ? 'eon2:deck:execute' : 'eon2:actions:execute', { id: key.id }, key.name)
  }
  return <section className="eon-mirror" aria-label="Eon telefon Control Deck aynası">
    {editMode && <div className="eon-mirror-title-row">
      <div className="eon-mirror-toolbar">
        <div className="eon-mirror-sync" role="status"><span className={layoutReady && !syncError ? 'is-connected' : ''}/>
          {syncError ? 'Senkronizasyon hatası' : layoutReady ? `Senkronize · v${serverLayout.revision}` : 'Bağlantı bekleniyor'}</div>
          <details ref={menuRef} className="eon-mirror-presets"><summary><LayoutTemplate size={16}/> Hazır düzen <ChevronDown size={15}/></summary>
            <div className="eon-mirror-presets-menu">{DECK_PRESETS.map(item => <button type="button" key={item.id} onClick={() => preset(item.id)}>
              <strong>{item.name}</strong><span>{item.info}</span></button>)}</div></details>
          <button type="button" className="eon-mirror-button is-quiet" onClick={closeEditor} disabled={saving}><X size={16}/> Vazgeç</button>
          <button type="button" className="eon-mirror-button is-primary" onClick={() => void save()} disabled={saving || !layoutReady || !changed}><Save size={16}/>{saving ? 'Kaydediliyor' : 'Kaydet'}</button>
      </div>
    </div>}
    <div className="eon-mirror-pages" aria-label="Deck ekranları">
      <select aria-label="Kontrol edilecek ekran" value={isKeys ? `keys:${keyPage}` : selectedPage} disabled={editMode || saving || naming !== null} onChange={event => setSelectedPage(event.target.value)}>
        <option value="panel">Deck</option>
        {pages.map(page => <option key={page.id} value={page.id}>{page.name}</option>)}
        {Array.from({ length: keyPageCount }, (_, index) => <option key={index} value={`keys:${index}`}>Tuşlar {index + 1}</option>)}
      </select>
      <button type="button" disabled={!layoutReady || editMode || saving || isKeys || naming !== null} onClick={openEditor}><Grip size={16}/> Düzeni düzenle</button>
      <button type="button" disabled={!layoutReady || editMode || saving || naming !== null} onClick={() => addPage()}><Plus size={16}/> Ekran ekle</button>
      <button type="button" disabled={!layoutReady || editMode || saving || isKeys || naming !== null} onClick={() => addPage(true)}>Çoğalt</button>
      {currentPage && <>
        <button type="button" disabled={editMode || saving} onClick={() => {
          setPageName(currentPage.name); setNaming('rename')
        }}>Adını değiştir</button>
        {([-1, 1] as const).map(delta => <button type="button" key={delta} aria-label={delta < 0 ? 'Ekranı önceye taşı' : 'Ekranı sonraya taşı'}
          disabled={editMode || saving || pages.indexOf(currentPage) + delta < 0 || pages.indexOf(currentPage) + delta >= pages.length}
          onClick={() => { const next = [...pages]; const from = pages.indexOf(currentPage); [next[from], next[from + delta]] = [next[from + delta], next[from]]; void savePages(next) }}>{delta < 0 ? <ArrowLeft size={16}/> : <ArrowRight size={16}/>}</button>)}
        <button type="button" disabled={editMode || saving} onClick={() => {
          if (window.confirm(`“${currentPage.name}” ekranı silinsin mi?`)) void savePages(pages.filter(page => page.id !== selectedPage), 'panel')
        }}>Ekranı sil</button>
      </>}
    </div>
    {naming && <form className="eon-mirror-pages" aria-label="Ekran adı" onSubmit={event => { event.preventDefault(); submitName() }}>
      <label>Ekran adı <input autoFocus required maxLength={80} value={pageName} onChange={event => setPageName(event.target.value)} /></label>
      <button type="submit" disabled={!pageName.trim() || saving}>Kaydet</button>
      <button type="button" onClick={() => setNaming(null)}>Vazgeç</button>
    </form>}
    {conflict && <div className="eon-mirror-conflict" role="alert"><strong>Deck başka cihazda değişmiş.</strong>
      <span>Telefondaki son düzeni alabilir veya kendi düzenini yeniden kaydedebilirsin.</span>
      <button type="button" onClick={() => {
        acceptLayout(conflict); editorBaseRevision.current = conflict.revision
        const page = conflict.pages?.find(page => page.id === selectedPage)
        const widgets = page?.widgets ?? conflict.widgets
        if (selectedPage !== 'panel' && !page) { setSelectedPage('panel'); setEditMode(false); setDraft(null); draftRef.current = null; editorBaseRevision.current = null; editorBase.current = null; setConflict(null); return }
        editorBase.current = { widgets: widgets.map(tile => ({ ...tile })), quickIds: (page ? page.quickIds : conflict.quickIds)?.slice() ?? null,
          hideShortcutNames: conflict.hideShortcutNames ?? false }
        setDraft(widgets.map(tile => ({ ...tile }))); draftRef.current = widgets.map(tile => ({ ...tile }))
        setDraftHideShortcutNames(conflict.hideShortcutNames ?? false); setDraftQuickIds((page ? page.quickIds : conflict.quickIds)?.slice() ?? null); setConflict(null)
      }}>Son düzeni al</button>
      <button type="button" onClick={() => void save(true)}>Benim düzenimi uygula</button>
    </div>}
    <div className="eon-mirror-stage">
      <div className="eon-mirror-phone">
        <div className={`eon-mirror-display ${isKeys ? 'is-key-page' : ''}`}>
          {isKeys ? <div className={`eon-mirror-all-keys ${denseKeys ? 'is-dense' : ''}`} aria-label={`Tuşlar ${keyPage + 1}`}>
            {pageKeys.map(key => <MirrorShortcut key={`${key.tool ? 'tool' : 'action'}:${key.id}`} item={key} busy={busy}
              phoneTile hideName={hideShortcutNames} onClick={() => {
                if (key.remoteEnabled === false) setMessage(`PC’de Kısayollar’dan “${key.name}” için telefon erişimini aç.`)
                else if (!key.available) setMessage('Bu tuş kullanılamıyor.')
                else runKey(key)
              }}/>)}
            {!pageKeys.length && <div className="eon-mirror-keys-notice">{deck ? 'Henüz kısayol yok' : 'Komutlar yükleniyor…'}</div>}
          </div> : <div className={`eon-mirror-grid ${editMode ? 'is-editing' : ''}`} ref={gridRef}
            onContextMenu={event => {
              event.preventDefault()
              const id = (event.target as Element).closest<HTMLElement>('[data-deck-widget]')?.dataset.deckWidget
              setContextMenu({ x: Math.max(8, Math.min(event.clientX, window.innerWidth - 260)), y: Math.max(8, Math.min(event.clientY, window.innerHeight - 350)), tile: activeTiles.find(tile => tile.id === id) })
            }}>
            {activeTiles.filter(tile => tile.visible).map(tile => {
              const candidate = preview?.id === tile.id ? preview : tile
              const overlapping = preview?.id === tile.id &&
                !(gesture.current?.mode === 'move' ? moveDeckTile(activeTiles, candidate) : patchDeckTile(activeTiles, candidate))
              return <div className={`eon-mirror-tile eon-mirror-tile--${tile.id} ${preview?.id === tile.id ? 'is-preview' : ''} ${overlapping ? 'is-conflicting' : ''}`}
                data-deck-widget={tile.id} key={tile.id} onDragStart={event => event.preventDefault()} tabIndex={0} aria-label={`${uiNames[tile.id]}; sürükleyerek taşı, Shift ve ok tuşlarıyla boyutlandır`}
                onPointerDown={event => startGesture(event, tile, 'move')} onPointerMove={moveGesture}
                onPointerUp={finishGesture} onPointerCancel={finishGesture}
                onLostPointerCapture={event => { if (gesture.current?.pointerId === event.pointerId) { gesture.current = null; setPreview(null); previewRef.current = null; suppressClick.current = false } }}
                onClickCapture={event => { if (suppressClick.current) { event.preventDefault(); event.stopPropagation() } }}
                onKeyDown={event => { if (event.target === event.currentTarget) keyboardMove(event, tile) }}
                style={{
                  gridColumn: `${tile.x + 1} / span ${tile.w}`, gridRow: `${tile.y + 1} / span ${tile.h}`,
                }}>
                <MirrorContent id={tile.id} snapshot={snapshot} data={deck} now={now} busy={busy} paired={connected > 0} quickIds={activeQuickIds} hideShortcutNames={hideShortcutNames}
                  mediaCommand={id => void run('eon2:deck:execute', { id }, 'Medya')}
                  command={runKey}/>
                {(['n', 's', 'e', 'w', 'ne', 'nw', 'se', 'sw'] as const).map(edge => <div key={edge}
                  className={`eon-mirror-edge edge-${edge}`} aria-hidden="true"
                  onPointerDown={event => { event.stopPropagation(); startGesture(event, tile, 'resize', edge) }}/>) }
              </div>
            })}
            {editMode && preview && <div className={`eon-mirror-ghost ${!(gesture.current?.mode === 'move' ? moveDeckTile(activeTiles, preview) : patchDeckTile(activeTiles, preview)) ? 'is-invalid' : ''}`}
              aria-hidden="true" style={{ gridColumn: `${preview.x + 1} / span ${preview.w}`, gridRow: `${preview.y + 1} / span ${preview.h}` }}/>}
          </div>}
          {editingQuick && <div className="eon-mirror-quick-overlay" role="dialog" aria-modal="true" aria-label="Deck hızlı kısayollarını düzenle">
            <header><div><strong>Hızlı erişim tuşları</strong><small>Telefonda ve bilgisayarda aynı altı kısayol görüntülenir.</small></div>
              <button type="button" aria-label="Kısayol düzenleyiciyi kapat" onClick={() => setEditingQuick(false)}><X size={16}/></button></header>
            <label className="eon-mirror-name-toggle"><input type="checkbox" checked={draftHideShortcutNames} disabled={saving} onChange={event => setDraftHideShortcutNames(event.target.checked)}/> Kısayol adlarını gizle (tüm ekranlar)</label>
            <div className="eon-mirror-quick-editor">
              {(() => {
                const keys: Array<DeckKey & { tool?: boolean; identity: string }> = [
                  ...(deck?.tools ?? []).map(item => ({ id:item.id, name:item.name, kind:item.icon, available:true, tool:true, identity:`tool:${item.id}` })),
                  ...(deck?.actions ?? []).map(item => ({...item, identity:`action:${item.id}` })),
                ]
                const ids = draftQuickIds ?? keys.filter(item => item.available).slice(0, 6).map(item => item.identity)
                const moveId = (id: string, delta: number) => {
                  const from = ids.indexOf(id); const to = from + delta
                  if (from < 0 || to < 0 || to >= ids.length) return
                  const next = [...ids]; next.splice(to, 0, next.splice(from, 1)[0]); setDraftQuickIds(next)
                }
                return <>
                  <div className="eon-mirror-quick-selected"><b>SEÇİLİ TUŞLAR ({ids.length}/6)</b>
                    {ids.map((identity, index) => {
                      const key = keys.find(item => item.identity === identity)
                      return <div key={identity}><span>{key?.name || identity}</span>
                        <button type="button" aria-label="Yukarı taşı" disabled={index === 0} onClick={() => moveId(identity, -1)}><ArrowUp size={14}/></button>
                        <button type="button" aria-label="Aşağı taşı" disabled={index === ids.length - 1} onClick={() => moveId(identity, 1)}><ArrowDown size={14}/></button>
                        <button type="button" aria-label="Kaldır" onClick={() => setDraftQuickIds(ids.filter(id => id !== identity))}><X size={14}/></button>
                      </div>
                    })}
                    {!ids.length && <span className="eon-mirror-quick-empty">Hiç kısayol seçili değil.</span>}
                  </div>
                  <div className="eon-mirror-quick-available"><b>EKLENEBİLİR</b>
                    {keys.filter(item => item.available && !ids.includes(item.identity)).map(key =>
                      <button type="button" key={key.identity} disabled={ids.length >= 6}
                        onClick={() => setDraftQuickIds([...ids, key.identity])}><Plus size={14}/>{key.name}</button>)}
                  </div>
                </>
              })()}
            </div>
            <footer><button type="button" onClick={() => setDraftQuickIds(null)}>Varsayılan altı tuş</button>
              <button type="button" className="is-done" onClick={() => { setEditingQuick(false); setMessage('Kısayollar hazır. Telefona göndermek için Kaydet.') }}>Tamam</button></footer>
          </div>}
          {isKeys ? <div className="eon-mirror-foot eon-mirror-keys-foot">
            <div className="eon-mirror-foot-status" role="status">
              <span className={connected ? 'is-connected' : ''}/>
              <span>{message || (connected ? snapshot?.hostname || 'Bağlı' : 'Çevrimdışı')}</span>
            </div>
            <nav className="eon-mirror-key-pages" aria-label="Deck sayfaları">
              <button type="button" onClick={() => setSelectedPage('panel')}>Deck</button>
              {pages.length + keyPageCount < 4 && pages.map(page => <button type="button" key={page.id}
                onClick={() => setSelectedPage(page.id)}>{page.name}</button>)}
              {Array.from({ length: keyPageCount }, (_, index) => index)
                .filter(index => keyPageCount <= 3 || Math.abs(index - keyPage) <= 1)
                .map(index => <button type="button" key={index} aria-current={index === keyPage ? 'page' : undefined}
                  onClick={() => setSelectedPage(`keys:${index}`)}>Tuşlar {index + 1}</button>)}
            </nav>
            <button type="button" aria-label={denseKeys ? '4×3 tuş dizilimine geç' : '5×3 tuş dizilimine geç'}
              onClick={() => setDenseKeys(!denseKeys)}>{denseKeys ? '5×3' : '4×3'}</button>
          </div> : <div className="eon-mirror-foot">
            <div className="eon-mirror-foot-status"><span className={connected ? 'is-connected' : ''}/><span>{message || (connected ? 'USB bağlantısı etkin' : 'Telefona bağlanmak için Cihazlar bölümünü aç')}</span></div>
            <div className="eon-mirror-foot-pages"><span className="is-current">{currentPage?.name ?? 'Deck'}</span><span>{pages.length + 1 + keyPageCount} ekran</span></div>
            <div className="eon-mirror-foot-tools">
              <button type="button" title="Notları aç" aria-label="Notlar" onClick={() => navigate('notes')}><Monitor size={15}/></button>
              <button type="button" title="Ayarları aç" aria-label="Ayarlar" onClick={() => navigate('settings')}><Settings2 size={15}/></button>
            </div>
          </div>}
        </div>
      </div>
    </div>
    {(syncError || message) && <div className="eon-mirror-bottom" role="status">{syncError || message}</div>}
    {contextMenu && <div ref={contextRef} className="eon-mirror-context" role="menu" aria-label="Deck seçenekleri" style={{ left: contextMenu.x, top: contextMenu.y }}
      onKeyDown={event => {
        const buttons = [...event.currentTarget.querySelectorAll<HTMLButtonElement>('button:not(:disabled)')]
        const index = buttons.indexOf(document.activeElement as HTMLButtonElement)
        if (event.key === 'ArrowDown' || event.key === 'ArrowUp') { event.preventDefault(); buttons[(index + (event.key === 'ArrowDown' ? 1 : -1) + buttons.length) % buttons.length]?.focus() }
      }}>
      {contextMenu.tile && <button role="menuitem" disabled={saving} onClick={() => { openEditor(); patch({ ...contextMenu.tile!, visible: false }); setContextMenu(null) }}>{uiNames[contextMenu.tile.id]} kartını gizle</button>}
      <button role="menuitem" disabled={!layoutReady || saving} onClick={() => { openEditor(); setEditingQuick(true); setContextMenu(null) }}>Kısayolları seç ve sırala</button>
      {DECK_PRESETS.map(item => <button role="menuitem" key={item.id} disabled={!layoutReady || saving} onClick={() => { openEditor(); preset(item.id); setContextMenu(null) }}>{item.name} düzeni</button>)}
      {activeTiles.filter(tile => !tile.visible).map(tile => <button role="menuitem" key={tile.id} disabled={saving} onClick={() => { openEditor(); patch({ ...tile, visible: true }); setContextMenu(null) }}>{uiNames[tile.id]} kartını göster</button>)}
      {editMode && <><button role="menuitem" disabled={saving || !changed} onClick={() => { void save(); setContextMenu(null) }}>Düzeni kaydet</button>
        <button role="menuitem" disabled={saving} onClick={() => { closeEditor(); setContextMenu(null) }}>Değişikliklerden vazgeç</button></>}
      <button role="menuitem" onClick={() => { navigate('devices'); setContextMenu(null) }}>Telefon ekranını aç</button>
    </div>}
  </section>
}
