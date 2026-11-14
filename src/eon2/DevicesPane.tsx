import { useCallback, useEffect, useState } from 'react'
import { ChevronDown, Download, LockKeyhole, MonitorPlay, RotateCcw, ShieldCheck, Smartphone, Trash2, Wifi } from 'lucide-react'
import type { IpcChannel } from '../../shared/contracts'
import { PhoneScreenSurface, type Device } from './PhoneScreenSurface'
import { PhoneInstall } from './PhoneSetup'
import './devices.css'

interface PairedDevice { id: string; name: string; pairedAt: number; permissions: string[] }
interface PairingOffer { id: string; expiresAt: number }
type PairingState = 'pending' | 'approved' | 'denied' | 'expired'
type TailnetState = { enabled: boolean; installed: boolean; running: boolean; online: boolean; dnsName: string | null; serving: boolean; port: number | null; reason: string | null }

type Props = {
  devices: Device[]
  error: string | null
  refreshing: boolean
  refresh: () => void
  serverReady?: boolean
  tunnelledSerials?: string[]
}

async function invoke<T>(channel: IpcChannel, payload?: unknown): Promise<T> {
  if (!window.kapanisDesktop) throw new Error('Cihaz işlemleri yalnızca Windows Eon Desktop içinde kullanılabilir.')
  return window.kapanisDesktop.invoke(channel, payload) as Promise<T>
}

export function DevicesPane({ devices, error, refreshing, refresh, serverReady, tunnelledSerials = [] }: Props) {
  const [paired, setPaired] = useState<PairedDevice[]>([])
  const [offer, setOffer] = useState<(PairingOffer & { serial: string }) | null>(null)
  const [busy, setBusy] = useState(false)
  const [message, setMessage] = useState<string | null>(null)
  const [tailnet, setTailnet] = useState<TailnetState | null>(null)
  const [tailnetBusy, setTailnetBusy] = useState(false)
  const [permissionBusy, setPermissionBusy] = useState<string | null>(null)
  const [installingSerial, setInstallingSerial] = useState<string | null>(null)
  const [installMessage, setInstallMessage] = useState<{ text: string; failed: boolean } | null>(null)
  const installApk = async (serial: string, name: string) => {
    setInstallingSerial(serial)
    setInstallMessage(null)
    try {
      const fileName = await invoke<string | null>('eon2:mobile:install-apk', { serial })
      if (fileName) setInstallMessage({ text: `${fileName}, ${name} cihazına kuruldu.`, failed: false })
    } catch (cause) {
      const detail = cause instanceof Error ? cause.message : 'Bilinmeyen hata.'
      setInstallMessage({ text: `${name} cihazına APK kurulamadı. ${detail}`, failed: true })
    } finally {
      setInstallingSerial(null)
    }
  }
  const refreshPaired = useCallback(async () => {
    try { setPaired(await invoke<PairedDevice[]>('eon2:paired-devices')) } catch { /* Web preview has no native bridge */ }
  }, [])
  useEffect(() => {
    void refreshPaired()
    const interval = setInterval(() => { if (!document.hidden) void refreshPaired() }, 2000)
    return () => clearInterval(interval)
  }, [refreshPaired])
  const refreshTailnet = useCallback(async () => {
    try { setTailnet(await invoke<TailnetState>('eon2:tailnet:get')) } catch { /* Web preview */ }
  }, [])
  useEffect(() => {
    void refreshTailnet()
    const timer = setInterval(() => { void refreshTailnet() }, 7000)
    return () => clearInterval(timer)
  }, [refreshTailnet])
  const toggleTailnet = async () => {
    if (!tailnet || tailnetBusy) return
    setTailnetBusy(true)
    try {
      const next = await invoke<TailnetState>('eon2:tailnet:set', { enabled: !tailnet.enabled })
      setTailnet(next)
      setMessage(next.enabled && !next.serving ? 'Tailscale etkinleştirildi ancak HTTPS dinleyicisi hazır değil. Ağ ve sertifikayı kontrol et.' : null)
    } catch (cause) { setMessage(cause instanceof Error ? cause.message : 'Tailscale ayarı değiştirilemedi.') }
    finally { setTailnetBusy(false) }
  }
  const begin = async (serial: string) => {
    setBusy(true); setMessage(null)
    try { setOffer({ ...(await invoke<PairingOffer>('eon2:pairing:begin', { serial })), serial }) }
    catch (cause) { setMessage(cause instanceof Error ? cause.message : 'Eşleştirme başlatılamadı.') }
    finally { setBusy(false) }
  }
  useEffect(() => {
    if (!offer) return
    let active = true
    const check = async () => {
      try {
        const state = await invoke<PairingState>('eon2:pairing:state', { id: offer.id })
        if (!active || state === 'pending') return
        setOffer(null)
        setMessage(state === 'approved' ? 'Telefon eşleştirmeyi kabul etti.' : state === 'denied' ? 'Telefon eşleştirmeyi reddetti.' : 'İstek sona erdi. USB bağlantısını kontrol et.')
        void refreshPaired()
      } catch (error) { if (active) setMessage(error instanceof Error ? error.message : 'İstek durumu alınamadı.') }
    }
    const timer = setInterval(() => void check(), 900)
    return () => { active = false; clearInterval(timer) }
  }, [offer, refreshPaired])
  const revoke = async (device: PairedDevice) => {
    if (!window.confirm(`${device.name} cihazının Eon erişimini iptal etmek istiyor musun?`)) return
    try { await invoke('eon2:pairing:revoke', { id: device.id }); await refreshPaired(); setMessage(`${device.name} cihazının erişimi iptal edildi.`) }
    catch (cause) { setMessage(cause instanceof Error ? cause.message : 'Cihaz iptal edilemedi.') }
  }
  const setPermission = async (device: PairedDevice, permission: string, enabled: boolean) => {
    const key = `${device.id}:${permission}`
    setPermissionBusy(key)
    setMessage(null)
    try { await invoke('eon2:permissions:set', { id: device.id, permission, enabled }); await refreshPaired() }
    catch (cause) { setMessage(cause instanceof Error ? cause.message : 'İzin kaydedilemedi.') }
    finally { setPermissionBusy(null) }
  }
  return <section className="eon2-devices" aria-label="Cihazlar">
    <div className="eon2-devices-toolbar">
      <button type="button" className="eon2-button eon2-button--quiet" disabled={refreshing} onClick={refresh}>
        <RotateCcw size={15} aria-hidden="true" className={refreshing ? 'eon2-phone-spin' : undefined}/>{refreshing ? 'Aranıyor…' : 'Yenile'}
      </button>
    </div>
    {serverReady === false && <div className="eon2-error" role="alert">Cihaz bağlantısı başlatılamadı. Eon’u yeniden açıp dene.</div>}
    {error && <div className="eon2-error" role="alert">Cihazlar aranamadı: {error}</div>}
    {message && <div className="eon2-pairing-message" role="status">{message}</div>}
    {installMessage && <div className={installMessage.failed ? 'eon2-error' : 'eon2-pairing-message'} role={installMessage.failed ? 'alert' : 'status'}>{installMessage.text}</div>}
    {devices.length ? <ul className="eon2-devices-list" aria-label="Algılanan cihazlar">{devices.map(device => {
      const authorised = device.state === 'device' && device.usb
      const name = device.model?.replace(/_/g, ' ') || 'Android cihaz'
      return <li className="eon2-devices-item" key={device.serial}>
        <div className="eon2-devices-row">
          <Smartphone size={26} strokeWidth={1.5} aria-hidden="true"/>
          <div className="eon2-devices-identity"><strong>{name}</strong>
            <span className={authorised ? 'is-connected' : ''}>{authorised ? 'USB ile bağlı' : device.state === 'unauthorized' ? 'Telefonda bağlantıya izin ver' : device.state === 'offline' ? 'Çevrimdışı · USB bağlantısını kontrol et' : device.usb ? device.state : 'Ağ bağlantısı · USB ile bağla'}</span>
          </div>
          {device.usb && <div className="eon2-devices-actions">
            <button type="button" disabled={!authorised || installingSerial !== null} className="eon2-button eon2-button--outline" onClick={() => void installApk(device.serial, name)} aria-label={`${name} cihazına APK kur`}>
              <Download size={14} aria-hidden="true"/>{installingSerial === device.serial ? 'Kurulum bekleniyor…' : 'APK kur'}
            </button>
            {authorised && <button type="button" disabled={busy || Boolean(offer) || serverReady === false} className="eon2-button eon2-button--outline" onClick={() => void begin(device.serial)} aria-label={`${name} ile Eon eşleştirmesini başlat`}>
              <LockKeyhole size={14} aria-hidden="true"/>{offer?.serial === device.serial ? 'Onay bekleniyor…' : 'Eşleştir'}
            </button>}
          </div>}
        </div>
        {authorised && <PhoneInstall serial={device.serial}/>}
        <details className="eon2-devices-technical"><summary>Bağlantı ayrıntıları</summary><p>Seri numarası: {device.serial}</p><p>{tunnelledSerials.includes(device.serial) ? 'Eon USB bağlantısı hazır' : device.usb ? 'USB bağlantısı' : 'Ağ üzerinden ADB'}</p></details>
      </li>
    })}</ul> : <div className="eon2-devices-empty" role="status">
      <Smartphone size={40} strokeWidth={1.25} aria-hidden="true"/>
      <h1>Telefonunu bağla</h1><p>USB kablosunu tak ve telefonunda bağlantıya izin ver.</p>
      <small>Cihazın burada görünecek.</small>
    </div>}
    {offer && <p className="eon2-pairing-message" role="status">Eşleştirmeyi telefonunda onayla.</p>}
    <div className="eon2-devices-options">
      <details className="eon2-devices-disclosure">
        <summary><MonitorPlay size={18} aria-hidden="true"/><span>PC ekran paylaşımı</span><ChevronDown size={16} aria-hidden="true"/></summary>
        <div className="eon2-devices-detail-body">
          <p>Eşleştirilmiş telefonda Ayarlar → PC ekranı bölümünü aç. Telefon ekran paylaşımı istediğinde burada görüntüye veya görüntüyle birlikte fare ve klavyeye izin verebilirsin.</p>
          <p>Paylaşım sırasında Windows ekranındaki göstergeden kontrolü kapatabilir veya oturumu bitirebilirsin.</p>
        </div>
      </details>
      <details className="eon2-devices-disclosure">
        <summary><MonitorPlay size={18} aria-hidden="true"/><span>Telefon ekranı</span><ChevronDown size={16} aria-hidden="true"/></summary>
        <PhoneScreenSurface devices={devices} minimal/>
      </details>
      <details className="eon2-devices-disclosure">
        <summary><ShieldCheck size={18} aria-hidden="true"/><span>Eşleştirmeler ve izinler</span><ChevronDown size={16} aria-hidden="true"/></summary>
        <div className="eon2-devices-detail-body">
          {paired.length ? <ul className="eon2-devices-list" aria-label="Eşleştirilmiş cihazlar">{paired.map(device => <li className="eon2-devices-paired" key={device.id}>
            <div className="eon2-devices-paired-heading"><strong>{device.name}</strong><button type="button" className="eon2-button eon2-button--quiet" aria-label={`${device.name} eşleştirmesini kaldır`} onClick={() => void revoke(device)}><Trash2 size={14} aria-hidden="true"/>Kaldır</button></div>
            <fieldset disabled={Boolean(permissionBusy)} className="eon2-devices-permissions"><legend>{device.name} erişim izinleri</legend>{([{ permission: 'files.transfer', label: 'Dosyalar' }, { permission: 'actions.execute', label: 'Kısayollar' }, { permission: 'power.manage', label: 'Güç' }] as const).map(item => <label key={item.permission}><input type="checkbox" checked={device.permissions.includes(item.permission)} onChange={event => { void setPermission(device, item.permission, event.target.checked) }}/>{item.label}</label>)}</fieldset>
            <details className="eon2-devices-technical"><summary>Cihaz bilgileri</summary><p>{device.id}</p><p>Eşleştirme: {new Date(device.pairedAt).toLocaleDateString('tr-TR')}</p></details>
          </li>)}</ul> : <p>Henüz eşleştirilmiş cihaz yok. Bağlı telefonunda Eon’u aç ve Eşleştir’i seç.</p>}
        </div>
      </details>
      <details className="eon2-devices-disclosure">
        <summary><Wifi size={18} aria-hidden="true"/><span>Kablosuz bağlantı</span>{tailnet?.serving && <small>Etkin</small>}<ChevronDown size={16} aria-hidden="true"/></summary>
        <div className="eon2-devices-detail-body eon2-devices-wireless"><div><strong>Tailscale</strong><p>{tailnet?.serving ? `Bağlantı etkin · ${tailnet.dnsName}:${tailnet.port}` : tailnet?.reason || (tailnet?.online ? 'Bağlantıyı etkinleştirebilirsin.' : 'Bu bilgisayarda Tailscale’i açıp hesabına giriş yap.')}</p><p>İlk eşleştirme için telefonunu USB ile bağla.</p></div>
          <button type="button" className="eon2-button eon2-button--outline" disabled={!tailnet || tailnetBusy || !tailnet.installed} onClick={() => void toggleTailnet()}>{tailnetBusy ? 'Kontrol ediliyor…' : tailnet?.enabled ? 'Kapat' : 'Etkinleştir'}</button>
        </div>
      </details>
    </div>
  </section>
}
