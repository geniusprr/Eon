import { useCallback, useEffect, useRef, useState } from 'react'
import { ArrowDownToLine, Check, RefreshCw, Smartphone } from 'lucide-react'
import type { IpcChannel } from '../../shared/contracts'
import type { UpdateCenterState } from '../../shared/eon-updates'
import './updates.css'

export function useUpdates() {
  const [state, setState] = useState<UpdateCenterState | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  useEffect(() => {
    const bridge = window.kapanisDesktop
    if (!bridge) return
    let alive = true
    const unsubscribe = bridge.on('eon2:updates:changed', payload => { if (alive) setState(payload as UpdateCenterState) })
    void bridge.invoke('eon2:updates:get').then(payload => { if (alive) setState(payload as UpdateCenterState) })
      .catch(() => { if (alive) setError('Güncelleme bilgisi alınamadı.') })
    return () => { alive = false; unsubscribe() }
  }, [])
  const action = useCallback(async (channel: IpcChannel, payload?: unknown) => {
    if (!window.kapanisDesktop) return
    setError(null); setBusy(true)
    try {
      const next = await window.kapanisDesktop.invoke(channel, payload)
      if (next) setState(next as UpdateCenterState)
    } catch (cause) { setError(cause instanceof Error ? cause.message : 'Güncelleme işlemi tamamlanamadı.') }
    finally { setBusy(false) }
  }, [])
  return { state, error, busy, action }
}
type Updates = ReturnType<typeof useUpdates>

function InstallConfirmation({ busy, onCancel, onInstall }: { busy: boolean; onCancel: () => void; onInstall: () => void }) {
  const dialog = useRef<HTMLDialogElement>(null)
  useEffect(() => { dialog.current?.showModal() }, [])
  return <dialog ref={dialog} className="eon-update-confirm" aria-labelledby="eon-update-confirm-title"
    onCancel={event => { event.preventDefault(); onCancel() }}>
    <h2 id="eon-update-confirm-title">Eon yeniden başlatılsın mı?</h2><p>Açık notlarını kaydet. İndirilen güncelleme kurulacak ve Eon yeniden açılacak.</p>
    <div><button autoFocus type="button" className="eon2-button eon2-button--outline" onClick={onCancel}>Daha sonra</button>
      <button type="button" className="eon2-button eon2-button--primary" disabled={busy} onClick={onInstall}>Kaydettim, kur</button></div>
  </dialog>
}

export function UpdateTitleButton({ updates, onOpen }: { updates: Updates; onOpen: () => void }) {
  const state = updates.state
  if (!state) return null
  const desktop = !!state.desktop.availableVersion && state.desktop.phase !== 'current'
  const mobile = state.mobile.devices.some(device => device.needsUpdate)
  if (!desktop && !mobile) return null
  const status = desktop ? state.desktop : state.mobile
  const downloading = status.phase === 'downloading'
  const label = downloading ? `İndiriliyor · %${Math.floor(status.progress ?? 0)}`
    : status.phase === 'downloaded' ? 'Güncelleme hazır' : status.phase === 'error' ? 'Güncellemeyi yeniden dene' : 'Güncelleme'
  return <button type="button" className="eon-update-title" onClick={onOpen} title="Güncellemeleri aç" aria-label={`${label}. Güncellemeleri aç`}>
    <ArrowDownToLine size={15}/><span>{label}</span>
    {downloading && <span className="eon-update-title-progress" style={{ width: `${status.progress ?? 0}%` }}/>} 
  </button>
}

export function UpdatesPanel({ updates }: { updates: Updates }) {
  const { state, busy, action, error } = updates
  const [confirmInstall, setConfirmInstall] = useState(false)
  const desktop = state?.desktop
  const mobile = state?.mobile
  return <section className="eon-updates" aria-labelledby="eon-updates-heading">
    <header><div><h2 id="eon-updates-heading" tabIndex={-1}>Güncellemeler</h2><p>Arka planda indirilir. Hazır olduğunda sen kurarsın.</p></div>
      <button type="button" className="eon2-button eon2-button--outline" disabled={busy || !state} onClick={() => void action('eon2:updates:check')}><RefreshCw size={15}/>Denetle</button></header>
    <div className="eon-update-row"><div><strong>Eon Desktop {desktop?.currentVersion && <small>v{desktop.currentVersion}</small>}</strong>
      <p role="status">{desktop?.message || 'Güncelleme bilgisi bekleniyor…'}{desktop?.availableVersion ? ` · v${desktop.availableVersion}` : ''}</p>
      {desktop?.phase === 'downloading' && <progress aria-label="Masaüstü güncellemesi indirme ilerlemesi" max={100} value={desktop.progress ?? 0}/>}</div>
      {desktop?.phase === 'downloaded' && <button type="button" className="eon2-button eon2-button--primary" disabled={busy} onClick={() => setConfirmInstall(true)}>Yeniden başlat ve kur</button>}
      {desktop?.phase === 'error' && <button type="button" className="eon2-button eon2-button--outline" disabled={busy} onClick={() => void action(desktop.availableVersion ? 'eon2:updates:download' : 'eon2:updates:check')}>Yeniden dene</button>}
      {desktop?.phase === 'current' && <Check size={18} aria-label="Güncel"/>}</div>
    <div className="eon-update-row"><div><strong><Smartphone size={16}/>Android companion</strong><p role="status">{mobile?.message || 'Telefon güncelleme bilgisi bekleniyor…'}</p>
      {mobile?.phase === 'downloading' && <progress aria-label="Telefon güncellemesi indirme ilerlemesi" max={100} value={mobile.progress ?? 0}/>}</div></div>
    {mobile?.devices.filter(device => device.needsUpdate).map(device => <div key={device.serial} className="eon-update-row"><span>{device.name} · v{mobile.version}</span>
      <button type="button" className="eon2-button eon2-button--outline" disabled={busy || mobile.phase !== 'downloaded'} onClick={() => void action('eon2:updates:install-mobile', { serial: device.serial })}>Telefona kur</button></div>)}
    {error && <p className="eon2-error" role="alert">{error}</p>}
    <small>Telefon kurulumu USB bağlantısı ve ayrıca onayınla yapılır. Güncelleme, mevcut verilerini koruyarak yüklenir.</small>
    {confirmInstall && <InstallConfirmation busy={busy} onCancel={() => setConfirmInstall(false)} onInstall={() => void action('eon2:updates:install')}/>}
  </section>
}
