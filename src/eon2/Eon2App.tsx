import '@fontsource-variable/bricolage-grotesque'
import { FileDropTargets, type DropDestination } from './FileDropTargets'
import { lazy, Suspense, useCallback, useEffect, useMemo, useState, type ReactNode } from 'react'
import { Check, ChevronLeft, ChevronRight, Command, HardDrive, LayoutDashboard, Laptop2, NotebookPen, Plus, Settings2, Smartphone, Sparkles } from 'lucide-react'
import type { IpcChannel } from '../../shared/contracts'
import { DevicesPane } from './DevicesPane'
import { PhoneSetupGuide } from './PhoneSetup'
import type { WorkspaceNote } from './EonNotesWorkspace'
import { ActionsPane, TransfersPane } from './ControlsPane'
import { APP_THEME_STORAGE_KEY, isAppTheme, type AppTheme } from '../theme'
import { EonLogo } from '../components/brand/EonLogo'
import { DeckMirror } from './DeckMirror'
import { useUpdates, UpdateTitleButton, UpdatesPanel } from './Updates'
import { EonAiHome, EonAiSettings, EonAiWorkspace, useEonAiController } from './EonAi'
import './eon2.css'
import './eon-glass.css'

type Section = 'dashboard' | 'ai' | 'notes' | 'devices' | 'automations' | 'transfers' | 'settings'
type Note = WorkspaceNote
const EonNotesWorkspace = lazy(async () => ({ default: (await import('./EonNotesWorkspace')).EonNotesWorkspace }))
type SystemSnapshot = {
  sampledAt: number; hostname: string; platform: string
  cpu: { usagePercent: number | null; logicalCores: number; model: string }
  memory: { totalBytes: number; usedBytes: number; usagePercent: number }
  disk?: { totalBytes: number; usedBytes: number; usagePercent: number }
  uptimeSeconds: number
}
type Device = { serial: string; model: string | null; state: string; usb: boolean }
type DeviceResult = { devices: Device[]; scannedAt: number; transport: string; serverReady?: boolean; tunnelledSerials?: string[] }

const menu: { id: Section; label: string; icon: typeof LayoutDashboard; helper?: string }[] = [
  { id: 'dashboard', label: 'Dashboard', icon: LayoutDashboard },
  { id: 'ai', label: 'Eon AI', icon: Sparkles },
  { id: 'notes', label: 'Eon Notes', icon: NotebookPen },
  { id: 'devices', label: 'Cihazlar', icon: Smartphone },
  { id: 'automations', label: 'PC Kısayolları', icon: Command },
  { id: 'transfers', label: 'Dosya Aktarımı', icon: HardDrive },
  { id: 'settings', label: 'Ayarlar', icon: Settings2 },
]
async function desktopInvoke<T>(channel: IpcChannel, payload?: unknown): Promise<T> {
  if (!window.kapanisDesktop) throw new Error('Canlı bilgisayar verileri Eon masaüstü uygulamasında kullanılabilir.')
  return window.kapanisDesktop.invoke(channel, payload) as Promise<T>
}

function friendlyError(error: unknown): string {
  return error instanceof Error ? error.message : 'İşlem tamamlanamadı.'
}

function SectionTitle({ eyebrow, title, description, actions }: { eyebrow: string; title: string; description?: string; actions?: ReactNode }) {
  return <div className="eon2-section-heading">
    <div><div className="eon2-eyebrow">{eyebrow}</div><h1>{title}</h1>{description && <p>{description}</p>}</div>
    {actions && <div className="eon2-section-actions">{actions}</div>}
  </div>
}

function ActionButton({ children, onClick, icon, variant = 'quiet', disabled, title }: {
  children: ReactNode; onClick: () => void; icon?: typeof Plus; variant?: 'quiet' | 'primary' | 'outline'; disabled?: boolean; title?: string
}) {
  const Icon = icon
  return <button type="button" title={title} className={`eon2-button eon2-button--${variant}`} onClick={onClick} disabled={disabled}>
    {Icon && <Icon aria-hidden="true" size={16} />}{children}
  </button>
}

type SharedSettings = { theme: AppTheme | null; tailscale: boolean; autostart: boolean }
type SettingsKey = keyof SharedSettings
type MaterialMode = 'glass' | 'system' | 'opaque'
const MATERIAL_STORAGE_KEY = 'eon2:material'

function Preferences({ theme, settings, onChange, error, material, onMaterialChange }: {
  theme: AppTheme; settings: SharedSettings | null
  onChange: (key: SettingsKey, value: AppTheme | boolean) => void; error: string | null
  material: MaterialMode; onMaterialChange: (mode: MaterialMode) => void
}) {
  const [backupMessage, setBackupMessage] = useState<string | null>(null)
  const backup = async (mode: 'import' | 'export') => {
    setBackupMessage(null)
    try {
      const result = await desktopInvoke<SharedSettings | boolean | null>(mode === 'import' ? 'eon2:settings:import' : 'eon2:settings:export')
      if (result) setBackupMessage(mode === 'import' ? 'Ayarlar içe aktarıldı.' : 'Ayarlar dışa aktarıldı.')
    } catch (error) { setBackupMessage(friendlyError(error)) }
  }
  return <>
    <SectionTitle eyebrow="" title="Ayarlar"/>
    <div className="eon2-theme-picker" aria-label="Görünüm">{([{ id: 'obsidian', label: 'Obsidian' }, { id: 'ocean', label: 'Okyanus' }, { id: 'violet', label: 'Mor aurora' }, { id: 'rose', label: 'Gün batımı' }, { id: 'light', label: 'Aydınlık' }] as const).map(item =>
      <button key={item.id} type="button" className={`eon2-theme-swatch eon2-theme-${item.id} ${theme === item.id ? 'is-selected' : ''}`} aria-pressed={theme === item.id} onClick={() => onChange('theme', item.id)}><span>{item.label}</span>{theme === item.id && <Check size={16}/>}</button>)}</div>
    <section className="eon2-settings-panel">
      <div className="eon2-settings-row"><div><strong>Yüzey görünümü</strong><p>Cam, dengeli saydamlık kullanır. Sistem, Windows erişilebilirlik tercihini izler.</p></div><div className="eon2-material-picker" role="group" aria-label="Yüzey görünümü">{([{ id: 'glass', label: 'Cam' }, { id: 'system', label: 'Sistem' }, { id: 'opaque', label: 'Opak' }] as const).map(mode => <button key={mode.id} type="button" aria-pressed={material === mode.id} onClick={() => onMaterialChange(mode.id)}>{mode.label}</button>)}</div></div>
      <label className="eon2-settings-row"><div><strong>Windows ile aç</strong><p>Oturum açıldığında Eon bildirim alanında başlar.</p></div><input type="checkbox" role="switch" checked={settings?.autostart ?? false} disabled={!settings} onChange={event => onChange('autostart', event.target.checked)}/></label>
      <label className="eon2-settings-row"><div><strong>Tailscale bağlantısı</strong><p>USB kablosu çıkarıldığında aynı Tailscale ağından bağlan.</p></div><input type="checkbox" role="switch" checked={settings?.tailscale ?? false} disabled={!settings} onChange={event => onChange('tailscale', event.target.checked)}/></label>
    </section>
    <section className="eon2-settings-panel"><div className="eon2-settings-row"><div><strong>Ayarları aktar</strong><p>Tema, başlangıç ve bağlantı ayarlarını JSON dosyasıyla taşı.</p></div><div className="eon2-section-actions"><ActionButton onClick={() => void backup('export')}>Dışa aktar</ActionButton><ActionButton onClick={() => void backup('import')}>İçe aktar</ActionButton></div></div>{backupMessage && <p role="status">{backupMessage}</p>}</section>
    {error && <p className="eon2-error" role="alert">{error}</p>}
  </>
}

export function Eon2App() {
  const updates = useUpdates()
  const [focusUpdates, setFocusUpdates] = useState(false)
  const [section, setSection] = useState<Section>('dashboard')
  useEffect(() => {
    if (section === 'settings' && focusUpdates) {
      document.getElementById('eon-updates-heading')?.focus()
      setFocusUpdates(false)
    }
  }, [section, focusUpdates])
  const ai = useEonAiController()
  const [notesActivated, setNotesActivated] = useState(false)
  const [snapshot, setSnapshot] = useState<SystemSnapshot | null>(null)
  const [deviceResult, setDeviceResult] = useState<DeviceResult | null>(null)
  const [deviceError, setDeviceError] = useState<string | null>(null)
  const [deviceRefreshing, setDeviceRefreshing] = useState(false)
  const [notes, setNotes] = useState<Note[]>([])
  const [notesError, setNotesError] = useState<string | null>(null)
  const [now, setNow] = useState(new Date())
  const [theme, setTheme] = useState<AppTheme>(() => { const saved = localStorage.getItem(APP_THEME_STORAGE_KEY) || localStorage.getItem('eon2:theme'); return isAppTheme(saved) ? saved : 'obsidian' })
  const [sidebarCompact, setSidebarCompact] = useState(true)
  const [material, setMaterial] = useState<MaterialMode>(() => {
    const saved = localStorage.getItem(MATERIAL_STORAGE_KEY)
    return saved === 'system' || saved === 'opaque' ? saved : 'glass'
  })
  const updateMaterial = (mode: MaterialMode) => {
    localStorage.setItem(MATERIAL_STORAGE_KEY, mode)
    setMaterial(mode)
  }
  const [settings, setSettings] = useState<SharedSettings | null>(null)
  const [settingsError, setSettingsError] = useState<string | null>(null)
  const [dropped, setDropped] = useState<{ destination: DropDestination; paths: string[] } | null>(null)
  const [dropError, setDropError] = useState<string | null>(null)
  const clearDrop = useCallback(() => setDropped(null), [])
  const onFileDrop = useCallback((destination: DropDestination, paths: string[]) => {
    setDropError(null)
    setDropped({ destination, paths })
    setSection(destination)
  }, [])
  const updateSettings = async (key: SettingsKey, value: AppTheme | boolean) => {
    setSettingsError(null)
    if (!window.kapanisDesktop && key === 'theme' && typeof value === 'string') { setTheme(value); return }
    try {
      const next = await desktopInvoke<SharedSettings>('eon2:settings:set', { key, value })
      setSettings(next)
      if (next.theme) setTheme(next.theme)
    } catch (error) { setSettingsError(friendlyError(error)) }
  }
  useEffect(() => {
    const bridge = window.kapanisDesktop
    if (!bridge) return
    let active = true
    const unsubscribe = bridge.on('eon2:theme:changed', (value: unknown) => {
      if (typeof value === 'string' && isAppTheme(value)) {
        setTheme(value)
        setSettings(current => current ? { ...current, theme: value } : current)
      }
    })
    const load = async () => {
      try {
        let next = await desktopInvoke<SharedSettings>('eon2:settings:get')
        if (!next.theme) {
          const saved = localStorage.getItem(APP_THEME_STORAGE_KEY) || localStorage.getItem('eon2:theme')
          next = await desktopInvoke<SharedSettings>('eon2:settings:set', { key: 'initialTheme', value: isAppTheme(saved) ? saved : 'obsidian' })
        }
        if (active) {
          setSettings(current => current?.theme === next.theme && current.autostart === next.autostart && current.tailscale === next.tailscale ? current : next)
          if (next.theme) setTheme(next.theme)
        }
      } catch (error) { if (active) setSettingsError(friendlyError(error)) }
    }
    void load()
    const interval = window.setInterval(() => { if (!document.hidden) void load() }, 3000)
    return () => { active = false; unsubscribe(); window.clearInterval(interval) }
  }, [])

  useEffect(() => {
    const bridge = window.kapanisDesktop
    if (!bridge) return
    return bridge.on('eon2:ai:navigate', (payload: unknown) => {
      const sectionName = typeof payload === 'string' ? payload
        : payload && typeof payload === 'object' && 'section' in payload ? payload.section : null
      if (typeof sectionName !== 'string') return
      const normalized = sectionName.toLowerCase().trim()
      const aliases: Record<string, Section> = {
        home: 'dashboard', deck: 'dashboard', dashboard: 'dashboard',
        ai: 'ai', notes: 'notes', note: 'notes',
        devices: 'devices', device: 'devices',
        actions: 'automations', shortcuts: 'automations', automations: 'automations',
        files: 'transfers', transfers: 'transfers', settings: 'settings',
      }
      const destination = aliases[normalized]
      if (destination) setSection(destination)
    })
  }, [])

  const [showPhoneGuide, setShowPhoneGuide] = useState(() => !localStorage.getItem('eon2:phone-guide-seen'))
  const closePhoneGuide = () => {
    localStorage.setItem('eon2:phone-guide-seen', '1')
    setShowPhoneGuide(false)
  }

  const refreshNotes = useCallback(async () => {
    try {
      const incoming = await desktopInvoke<Note[]>('eon2:notes:list')
      setNotes(previous => previous.length === incoming.length && previous.every((note, index) =>
        note.id === incoming[index].id && note.revisionId === incoming[index].revisionId &&
        note.updatedAt === incoming[index].updatedAt && note.path === incoming[index].path &&
        note.unresolved === incoming[index].unresolved &&
        (!note.unresolved || JSON.stringify(note.conflict) === JSON.stringify(incoming[index].conflict))
      ) ? previous : incoming)
      setNotesError(null)
    }
    catch (error) { setNotesError(friendlyError(error)) }
  }, [])
  const refreshDevices = useCallback(async () => {
    setDeviceRefreshing(true)
    try { setDeviceResult(await desktopInvoke<DeviceResult>('eon2:devices')); setDeviceError(null) }
    catch (error) { setDeviceError(friendlyError(error)) }
    finally { setDeviceRefreshing(false) }
  }, [])

  useEffect(() => {
    const scheme = theme === 'light' ? 'light' : 'dark'
    localStorage.setItem(APP_THEME_STORAGE_KEY, theme)
    document.documentElement.style.colorScheme = scheme
    void desktopInvoke('eon2:theme:set', scheme).catch(() => { /* Browser preview has no native caption. */ })
  }, [theme])
  useEffect(() => { void refreshNotes() }, [refreshNotes])
  useEffect(() => { if (section === 'notes') setNotesActivated(true) }, [section])
  useEffect(() => {
    const timer = window.setInterval(() => {
      if (!document.hidden && section === 'notes') void refreshNotes()
    }, 4500)
    return () => window.clearInterval(timer)
  }, [section, refreshNotes])
  useEffect(() => {
    let alive = true
    const update = async () => {
      try { const next = await desktopInvoke<SystemSnapshot>('eon2:system-snapshot'); if (alive) setSnapshot(next) }
      catch { if (alive) setSnapshot(null) }
    }
    void update()
    const id = window.setInterval(() => { if (!document.hidden && (section === 'dashboard' || section === 'ai')) void update() }, 2000)
    return () => { alive = false; window.clearInterval(id) }
  }, [section])
  useEffect(() => {
    void refreshDevices()
    const id = window.setInterval(() => { if (!document.hidden) void refreshDevices() }, 5000)
    return () => window.clearInterval(id)
  }, [section, refreshDevices])
  useEffect(() => {
    const id = window.setInterval(() => setNow(new Date()), 15000)
    return () => window.clearInterval(id)
  }, [])

  const devices = deviceResult?.devices || []
  const deviceConnected = devices.some(device => device.usb && device.state === 'device')
  const connectionLabel = deviceConnected ? 'Cihaz bağlı' : 'Cihaz bağlı değil'
  const title = useMemo(() => menu.find((item) => item.id === section)?.label || 'Dashboard', [section])
  const SectionIcon = menu.find(item => item.id === section)?.icon || LayoutDashboard
  return <div data-material={material} className={`eon2-app eon2-theme-${theme} ${sidebarCompact ? 'is-sidebar-compact' : ''} ${window.kapanisDesktop ? 'is-desktop-window' : ''}`}>
    <aside className="eon2-sidebar" aria-label="Ana navigasyon"><button type="button" className="eon2-logo" onClick={() => setSection('dashboard')} aria-label="Eon ana sayfa" title="Eon ana sayfa"><span className="eon2-logo-mark"><EonLogo size={32}/></span><span className="eon2-logo-word">Eon</span></button>
      <nav id="eon2-workspace-nav" className="eon2-nav" aria-label="Çalışma alanları">{menu.map(({ id, label, icon: Icon }) => <button key={id} type="button" aria-current={section === id ? 'page' : undefined} className={`eon2-nav-item ${section === id ? 'is-active' : ''}`} title={label} onClick={() => setSection(id)}><Icon aria-hidden="true" size={19} strokeWidth={1.8}/><span>{label}</span></button>)}</nav>
      <div className="eon2-sidebar-bottom">
        <div className="eon2-sidebar-device" role="group" aria-label={`${snapshot?.hostname || 'Windows PC'} · ${snapshot ? 'Sistem etkin' : 'Bağlantı bekleniyor'}`} title={`${snapshot?.hostname || 'Windows PC'} · ${snapshot ? 'Sistem etkin' : 'Bağlantı bekleniyor'}`}>
          <div className="eon2-sidebar-device-icon"><Laptop2 aria-hidden="true" size={18}/></div>
          <div><strong>{snapshot?.hostname || 'Windows PC'}</strong><small><span className={`eon2-online-dot ${snapshot ? '' : 'is-offline'}`}/> {snapshot ? 'Sistem etkin' : 'Bağlantı bekleniyor'}</small></div>
        </div>
        <button type="button" className="eon2-sidebar-collapse" aria-controls="eon2-workspace-nav" aria-expanded={!sidebarCompact} aria-label={sidebarCompact ? 'Menüyü genişlet' : 'Menüyü daralt'} title={sidebarCompact ? 'Menüyü genişlet' : 'Menüyü daralt'} onClick={() => setSidebarCompact((current) => !current)}>{sidebarCompact ? <ChevronRight aria-hidden="true" size={17}/> : <ChevronLeft aria-hidden="true" size={17}/>}<span>Menüyü daralt</span></button>
      </div>
    </aside>
    <div className="eon2-main"><header className="eon2-topbar" aria-label="Pencere başlığı">
      <div className="eon2-title-context"><SectionIcon aria-hidden="true" size={20} strokeWidth={1.7}/><span>{title}</span></div>
      <UpdateTitleButton updates={updates} onOpen={() => { setSection('settings'); setFocusUpdates(true) }}/>
      <button type="button" className="eon2-title-connection" onClick={() => setSection('devices')} title={connectionLabel} aria-label={`${connectionLabel}. Cihazlar bölümünü aç`}>
        <span aria-hidden="true" className={`eon2-title-status-dot ${deviceConnected ? 'is-connected' : ''}`}/><span className="eon2-title-status-label">{connectionLabel}</span>
      </button>
    </header>
      <main className={`eon2-content ${section === 'dashboard' ? 'eon2-content--board' : ''}`} id="main-content">
        {section === 'dashboard' && <><DeckMirror snapshot={snapshot} devices={devices} now={now} navigate={setSection}/><EonAiHome ai={ai} onOpen={() => setSection('ai')}/></>}
        {section === 'ai' && <EonAiWorkspace ai={ai} snapshot={snapshot} now={now}/>}

        {section === 'notes' && notesError && <div className="eon2-error" role="alert">{notesError}</div>}
        {notesActivated && <Suspense fallback={section === 'notes' ? <div className="eon2-empty" role="status">Notlar açılıyor...</div> : null}>
          <EonNotesWorkspace notes={notes} refresh={refreshNotes} active={section === 'notes'}/>
        </Suspense>}
        {section === 'devices' && <DevicesPane devices={devices} error={deviceError} refreshing={deviceRefreshing} refresh={() => { void refreshDevices() }} serverReady={deviceResult?.serverReady} tunnelledSerials={deviceResult?.tunnelledSerials}/>}
        {section === 'automations' && <ActionsPane droppedPaths={dropped?.destination === 'automations' ? dropped.paths : undefined} clearDrop={clearDrop}/>}
        {section === 'transfers' && <TransfersPane droppedPaths={dropped?.destination === 'transfers' ? dropped.paths : undefined} clearDrop={clearDrop}/>}
        {section === 'settings' && <><Preferences theme={theme} settings={settings} error={settingsError} onChange={(key, value) => void updateSettings(key, value)} material={material} onMaterialChange={updateMaterial}/><UpdatesPanel updates={updates}/><button type="button" className="eon2-button eon2-button--outline" onClick={() => setShowPhoneGuide(true)}>Telefon bağlama rehberi</button></>}
      </main>
    </div>
    <FileDropTargets onDrop={onFileDrop} onError={setDropError}/>
    {dropError && <div className="eon2-drop-error eon2-error" role="alert">{dropError}<button className="eon2-button eon2-button--quiet" onClick={() => setDropError(null)}>Kapat</button></div>}
    {showPhoneGuide && <PhoneSetupGuide onClose={closePhoneGuide} onDevices={() => { closePhoneGuide(); setSection('devices') }}/>}
    {ai.settingsOpen && <EonAiSettings ai={ai}/>}
  </div>
}
