import { customActionIcon } from './controls/actionIcons'
import type { ActionIconId } from '../../shared/eon-controls'
import { useCallback, useEffect, useState, type ReactNode } from 'react'
import {
  AppWindow, ArrowUpFromLine, BarChart3, ChevronLeft, ChevronRight,
  Command, FileText, Folder, Headphones, LockKeyhole,
  Pause, Play, Power, RotateCcw, Settings2, SkipBack, SkipForward, Smartphone,
  Terminal, TimerOff, Volume1, Volume2, VolumeX,
} from 'lucide-react'
import type { IpcChannel } from '../../shared/contracts'
import { PhoneScreenSurface, type Device } from './PhoneScreenSurface'
import './landscape-dashboard.css'
import './landscape-phone.css'

type Section = 'dashboard' | 'notes' | 'devices' | 'automations' | 'transfers' | 'settings'

type SystemSnapshot = {
  hostname: string
  cpu: { usagePercent: number | null }
  memory: { usagePercent: number }
  disk?: { usagePercent: number }
}

type DeckKey = {
  id: string
  name: string
  kind: string
  icon?: ActionIconId
  available: boolean
  remoteEnabled?: boolean
}

type DeckState = {
  tools: Array<{ id: string; name: string; icon: string }>
  actions: DeckKey[]
  mediaAvailable: boolean
  gpu?: { usagePercent: number; temperatureC?: number | null } | null
  media?: { title: string; artist: string; playing: boolean } | null
}

type Props = {
  snapshot: SystemSnapshot | null
  now: Date
  devices: Device[]
  navigate: (section: Section) => void
}

const localDeck: DeckState = { tools: [], actions: [], mediaAvailable: false }
const keyKinds: Record<string, typeof Folder> = {
  folder: Folder, file: Folder, terminal: Terminal, command: Terminal,
  chart: BarChart3, settings: Settings2, lock: LockKeyhole,
  restart: RotateCcw, shutdown: Power, cancel: TimerOff,
  application: AppWindow,
}

const keyColors: Record<string, string> = {
  folder: 'amber', file: 'amber', terminal: 'violet', command: 'violet', chart: 'teal',
  settings: 'muted', lock: 'coral', restart: 'coral', shutdown: 'coral', cancel: 'coral',
}

async function invoke<T>(channel: IpcChannel, payload?: unknown): Promise<T> {
  if (!window.kapanisDesktop) throw new Error('Eon masaüstü bağlantısı bulunamadı.')
  return window.kapanisDesktop.invoke(channel, payload) as Promise<T>
}

function Clock({ now }: { now: Date }) {
  return <div className="eon-deck-clock">
    <time dateTime={now.toISOString()} className="eon-deck-clock-time">
      {now.toLocaleTimeString('tr-TR', { hour: '2-digit', minute: '2-digit' })}
    </time>
    <span className="eon-deck-clock-date">{now.toLocaleDateString('tr-TR', { day: 'numeric', month: 'long', weekday: 'long' })}</span>
  </div>
}

function Gauge({ title, value, tone, detail }: {
  title: string; value?: number | null; tone: 'teal' | 'violet' | 'blue' | 'amber'; detail?: string
}) {
  const number = typeof value === 'number' && Number.isFinite(value) ? Math.max(0, Math.min(100, value)) : null
  return <div className={`eon-deck-gauge eon-deck-tone-${tone}`}>
    <div className="eon-deck-gauge-ring" role="progressbar" aria-label={`${title} kullanımı`}
      aria-valuemin={0} aria-valuemax={100} aria-valuenow={number === null ? undefined : Math.round(number)}
      aria-valuetext={number === null ? 'Veri yok' : `${Math.round(number)} yüzde`}>
      <svg viewBox="0 0 120 120" aria-hidden="true">
        <circle cx="60" cy="60" r="49" className="eon-deck-ring-track"/>
        <circle cx="60" cy="60" r="49" className="eon-deck-ring-fill"
          strokeDasharray={`${number === null ? 0 : number * 3.07876} 307.876`} />
      </svg>
      <span>{number === null ? '—' : `${Math.round(number)}%`}</span>
    </div>
    <strong>{title}{detail && <small> · {detail}</small>}</strong>
  </div>
}

function Shortcut({ item, busy, activate }: { item: DeckKey; busy: boolean; activate: (item: DeckKey) => void }) {
  const Icon = customActionIcon(item.icon) ?? keyKinds[item.kind] ?? Command
  const tone = keyColors[item.kind] || 'blue'
  return <button type="button" className={`eon-deck-shortcut eon-deck-tone-${tone}`}
    disabled={busy || !item.available} onClick={() => activate(item)} title={item.name}>
    {!item.available && <LockKeyhole className="eon-deck-locked" size={13} aria-hidden="true"/>}
    <Icon size={27} strokeWidth={1.8} aria-hidden="true"/>
    <span>{item.name}</span>
  </button>
}

function MediaButton({ label, children, onClick, disabled, prominent }: {
  label: string; children: ReactNode; onClick: () => void; disabled: boolean; prominent?: boolean
}) {
  return <button type="button" className={`eon-deck-media-button ${prominent ? 'is-prominent' : ''}`}
    onClick={onClick} disabled={disabled} aria-label={label} title={label}>{children}</button>
}

export function LandscapeDashboard({ snapshot, now, devices, navigate }: Props) {
  const [data, setData] = useState<DeckState>(localDeck)
  const [error, setError] = useState<string | null>(null)
  const [notice, setNotice] = useState<string | null>(null)
  const [running, setRunning] = useState(false)
  const [page, setPage] = useState(0)

  const refresh = useCallback(async () => {
    try {
      setData(await invoke<DeckState>('eon2:deck:get'))
      setError(null)
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Kontrol paneli güncellenemedi.')
    }
  }, [])

  useEffect(() => {
    void refresh()
    const interval = window.setInterval(() => { if (!document.hidden) void refresh() }, 3000)
    const visible = () => { if (!document.hidden) void refresh() }
    document.addEventListener('visibilitychange', visible)
    return () => { window.clearInterval(interval); document.removeEventListener('visibilitychange', visible) }
  }, [refresh])

  const execute = async (item: DeckKey) => {
    if (running || !item.available) return
    if (['shutdown', 'restart', 'lock', 'cancel', 'command'].includes(item.kind) &&
      !window.confirm(`“${item.name}” bilgisayarında çalıştırılsın mı?`)) return
    setRunning(true)
    setNotice(null)
    try {
      const tool = data.tools.some(entry => entry.id === item.id)
      await invoke(tool ? 'eon2:deck:execute' : 'eon2:actions:execute', { id: item.id })
      setNotice(`${item.name} · Komut gönderildi`)
      void refresh()
    } catch (cause) {
      setNotice(cause instanceof Error ? cause.message : 'Komut çalıştırılamadı.')
    } finally { setRunning(false) }
  }

  const mediaAction = async (id: string, label: string) => {
    if (running || !data.mediaAvailable) return
    setRunning(true)
    try {
      await invoke('eon2:deck:execute', { id })
      setNotice(`${label} · Komut gönderildi`)
      void refresh()
    } catch (cause) {
      setNotice(cause instanceof Error ? cause.message : 'Medya kontrolü çalıştırılamadı.')
    } finally { setRunning(false) }
  }

  const keys: DeckKey[] = [
    ...data.tools.map(tool => ({ id: tool.id, name: tool.name, kind: tool.icon, available: true })),
    ...data.actions,
  ]
  const pages = Math.max(1, Math.ceil(keys.length / 12))
  const currentPage = Math.min(page, pages)
  const connected = devices.filter(device => device.usb && device.state === 'device').length
  const mediaEnabled = data.mediaAvailable && !running
  const mediaTitle = data.media?.title?.trim() || 'PC medyası'
  const mediaDetail = data.media?.artist?.trim() || (data.media === null ? 'Açık medya yok' : 'Windows medya oturumu')

  return <section className="eon-deck" aria-label="Eon yatay kontrol paneli">
    <h1 className="eon2-visually-hidden">Eon kontrol paneli</h1>
    <div className="eon-deck-body">
      {currentPage === 0 ? <div className={`eon-deck-dashboard ${data.gpu ? 'has-gpu' : ''}`}>
        <div className="eon-deck-metrics">
          <Clock now={now}/>
          <Gauge title="CPU" value={snapshot?.cpu.usagePercent} tone="teal"/>
          {data.gpu && <Gauge title="GPU" value={data.gpu.usagePercent} detail={data.gpu.temperatureC == null ? undefined : `${data.gpu.temperatureC}°C`} tone="blue"/>}
          <Gauge title="RAM" value={snapshot?.memory.usagePercent} tone="violet"/>
          <Gauge title="Disk" value={snapshot?.disk?.usagePercent} tone="amber"/>
        </div>
        <div className="eon-deck-lower">
          <section className="eon-deck-media" aria-label="Medya denetimi">
            <div className="eon-deck-media-heading"><Headphones size={20} aria-hidden="true"/>
              <div><strong title={mediaTitle}>{mediaTitle}</strong><small title={mediaDetail}>{mediaDetail}</small></div>
            </div>
            <div className="eon-deck-media-controls">
              <MediaButton label="Önceki parça" disabled={!mediaEnabled} onClick={() => void mediaAction('previous', 'Önceki parça')}><SkipBack size={23}/></MediaButton>
              <MediaButton label={data.media?.playing ? 'Duraklat' : 'Oynat'} prominent disabled={!mediaEnabled} onClick={() => void mediaAction('playPause', 'Oynat/duraklat')}>{data.media?.playing ? <Pause size={25}/> : <Play size={25}/>}</MediaButton>
              <MediaButton label="Sonraki parça" disabled={!mediaEnabled} onClick={() => void mediaAction('next', 'Sonraki parça')}><SkipForward size={23}/></MediaButton>
            </div>
            <div className="eon-deck-media-controls eon-deck-volume-controls">
              <MediaButton label="Sesi azalt" disabled={!mediaEnabled} onClick={() => void mediaAction('volumeDown', 'Sesi azalt')}><Volume1 size={21}/></MediaButton>
              <MediaButton label="Sessize al" disabled={!mediaEnabled} onClick={() => void mediaAction('mute', 'Sessize al')}><VolumeX size={21}/></MediaButton>
              <MediaButton label="Sesi artır" disabled={!mediaEnabled} onClick={() => void mediaAction('volumeUp', 'Sesi artır')}><Volume2 size={21}/></MediaButton>
            </div>
          </section>
          <section className="eon-deck-shortcuts" aria-label="Hızlı PC kısayolları">
            {keys.length ? <div className="eon-deck-keys is-compact">
              {keys.slice(0, 6).map(item => <Shortcut key={item.id} item={item} busy={running} activate={item => void execute(item)}/>)}
            </div> : <div className="eon-deck-empty">
              <Command size={28} aria-hidden="true"/>
              <strong>{error ? 'Kısayollar yüklenemedi' : 'Henüz kısayol yok'}</strong>
              <p>{error || 'Dosyalar, terminal ve kendi kısayolların burada görünür.'}</p>
              <button type="button" onClick={() => error ? void refresh() : navigate('automations')}>
                {error ? 'Tekrar dene' : 'Kısayolları aç'}
              </button>
            </div>}
          </section>
        </div>
        <aside className="eon-deck-phone" aria-label="Ana sayfa telefon ekranı">
          <PhoneScreenSurface devices={devices} compact />
        </aside>
      </div> : <div className="eon-deck-keys eon-deck-keys--page" aria-label={`Kısayol sayfası ${currentPage}`}>
        {keys.slice((currentPage - 1) * 12, currentPage * 12).map(item =>
          <Shortcut key={item.id} item={item} busy={running} activate={item => void execute(item)}/>)}
      </div>}
    </div>
    <footer className="eon-deck-footer">
      <div className="eon-deck-status" role="status" aria-live="polite">
        <span className={`eon-deck-status-dot ${snapshot ? 'is-online' : ''}`}/>
        <span title={notice || error || snapshot?.hostname || 'Bilgisayar'}>{notice || (running ? 'Komut gönderiliyor…' : error || `${snapshot?.hostname || 'Yerel PC'} · ${connected ? `${connected} USB cihaz` : 'Yerel'}`)}</span>
      </div>
      <nav className="eon-deck-pages" aria-label="Deck sayfaları">
        {pages > 1 && <button type="button" aria-label="Önceki sayfa" disabled={currentPage === 0} onClick={() => setPage(currentPage - 1)}><ChevronLeft size={17}/></button>}
        <button type="button" className={currentPage === 0 ? 'is-active' : ''} aria-current={currentPage === 0 ? 'page' : undefined} onClick={() => setPage(0)}>Panel</button>
        {Array.from({ length: pages }, (_, index) => <button type="button" key={index} className={currentPage === index + 1 ? 'is-active' : ''}
          aria-current={currentPage === index + 1 ? 'page' : undefined} onClick={() => setPage(index + 1)}>{pages === 1 ? 'Tuşlar' : `Tuşlar ${index + 1}`}</button>)}
        {pages > 1 && <button type="button" aria-label="Sonraki sayfa" disabled={currentPage === pages} onClick={() => setPage(currentPage + 1)}><ChevronRight size={17}/></button>}
      </nav>
      <nav className="eon-deck-navigation" aria-label="Eon bölümleri">
        <button type="button" onClick={() => navigate('notes')} title="Notları aç"><FileText size={20}/><span>Notlar</span></button>
        <button type="button" onClick={() => navigate('devices')} title="Cihazları aç"><Smartphone size={20}/><span>Cihazlar</span></button>
        <button type="button" onClick={() => navigate('transfers')} title="Dosya aktarımı"><ArrowUpFromLine size={20}/><span>Dosyalar</span></button>
        <button type="button" onClick={() => navigate('automations')} title="PC kısayolları"><Command size={20}/><span>Kısayollar</span></button>
        <button type="button" onClick={() => navigate('settings')} title="Ayarları aç"><Settings2 size={20}/><span>Ayarlar</span></button>
      </nav>
    </footer>
  </section>
}
