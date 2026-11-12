import { useCallback, useEffect, useState } from 'react'
import { ArrowDownToLine, ArrowUpFromLine, Check, Plus, X } from 'lucide-react'
import type { IpcChannel } from '../../shared/contracts'
import type { TransferFile } from '../../shared/eon-controls'
export { ActionsPane } from './controls/ActionsPane'

async function invoke<T>(channel: IpcChannel, payload?: unknown): Promise<T> {
  if (!window.kapanisDesktop) throw new Error('Bu işlem Eon masaüstü uygulamasında kullanılabilir.')
  return window.kapanisDesktop.invoke(channel, payload) as Promise<T>
}
const errorText = (error: unknown) => error instanceof Error ? error.message : 'İşlem tamamlanamadı.'

export function TransfersPane({ droppedPaths, clearDrop }: { droppedPaths?: string[]; clearDrop: () => void }) {
  const [files, setFiles] = useState<TransferFile[]>([])
  const [directory, setDirectory] = useState('')
  const [devices, setDevices] = useState<Array<{ id: string; name: string; permissions: string[] }>>([])
  const [selected, setSelected] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const reload = useCallback(async () => {
    const [nextFiles, nextDevices, nextDirectory] = await Promise.all([invoke<TransferFile[]>('eon2:files:list'), invoke<typeof devices>('eon2:paired-devices'), invoke<string>('eon2:files:directory')])
    setDirectory(nextDirectory); setFiles(nextFiles); setDevices(nextDevices.filter(device => device.permissions.includes('files.transfer')))
  }, [])
  useEffect(() => { void reload().catch(error => setError(errorText(error))); const id = setInterval(() => { if (!document.hidden) void reload().catch(error => setError(errorText(error))) }, 2000); return () => clearInterval(id) }, [reload])
  const target = devices.find(device => device.id === selected)?.id || (droppedPaths && devices.length > 1 ? '' : devices[0]?.id || '')
  return <><div className="eon2-section-heading"><div><div className="eon2-eyebrow">USB · TAILSCALE</div><h1>Dosya aktarımı</h1><p>Telefon ve bilgisayar arasında onay penceresi olmadan çift yönlü aktarım.</p></div></div>
    <section className="eon2-transfer-drop"><span className="eon2-empty-icon"><ArrowUpFromLine size={28}/></span><h2>Dosyalarını yanına al.</h2><p>Dosyayı seç; Eon telefonunda açıkken doğrudan Downloads klasörüne kaydedilir.</p><div className="eon2-section-actions"><select aria-label="Alıcı cihaz" value={target} onChange={event => setSelected(event.target.value)}>{!target && <option value="">{devices.length ? 'Alıcı seç' : 'Önce cihazına dosya izni ver'}</option>}{devices.map(device => <option value={device.id} key={device.id}>{device.name}</option>)}</select><button disabled={busy || !target} className="eon2-button eon2-button--primary" onClick={async () => { setBusy(true); setError(null); try { if (droppedPaths) { await invoke('eon2:files:drop', { deviceId: target, paths: droppedPaths }); clearDrop() } else await invoke('eon2:files:offer', { deviceId: target }); await reload() } catch (error) { setError(errorText(error)) } finally { setBusy(false) } }}><Plus size={16}/> {droppedPaths ? 'Gönder' : 'Dosya seç'}</button></div></section>
    <section className="eon2-transfer-directory" aria-label="Gelen dosyaların konumu"><div><strong>PC’ye gelen dosyalar</strong><p>{directory || 'Konum yükleniyor…'}</p><small>Yeni dosyalar seçtiğin klasöre otomatik kaydedilir. Önceki dosyalar taşınmaz.</small></div><div className="eon2-section-actions"><button className="eon2-button eon2-button--outline" disabled={busy} onClick={async () => { setBusy(true); try { setDirectory(await invoke<string>('eon2:files:choose-directory')) } catch (error) { setError(errorText(error)) } finally { setBusy(false) } }}>Klasörü değiştir</button><button className="eon2-button eon2-button--quiet" onClick={() => void invoke('eon2:files:open-directory').catch(error => setError(errorText(error)))}>Klasörü aç</button></div></section>
    {droppedPaths && <div className="eon2-drop-selection"><ul aria-label="Bırakılan dosyalar">{droppedPaths.map(file => <li key={file}>{file.split(/[\\/]/).pop()}</li>)}</ul><button className="eon2-button eon2-button--quiet" type="button" onClick={clearDrop}>Temizle</button></div>}
    {error && <p role="alert" className="eon2-error">{error}</p>}
    <div className="eon2-panel-heading"><h2>Aktarım kuyruğu</h2><span className="eon2-quiet-label">{files.length} dosya</span></div>
    {!files.length && <div className="eon2-empty"><ArrowDownToLine size={25}/><strong>Aktarıma hazır</strong><p>Telefondan da dosya gönderebilirsin. Cihazlar bölümünden dosya aktarım iznini aç.</p></div>}
    <div className="eon2-device-list">{files.map(file => <article className="eon2-device-card" key={file.id}>{file.direction === 'send' ? <ArrowUpFromLine size={20}/> : <ArrowDownToLine size={20}/>}<div className="eon2-device-primary">{file.direction === 'receive' && file.state === 'completed' ? <button type="button" className="eon2-transfer-name" title="Dosyayı aç" onClick={() => void invoke('eon2:files:open', { id: file.id }).catch(error => setError(errorText(error)))}>{file.fileName}</button> : <strong>{file.fileName}</strong>}<small>{(file.size / 1048576).toLocaleString('tr-TR', { maximumFractionDigits: 1 })} MB · {file.state === 'completed' ? 'Tamamlandı' : file.state === 'cancelled' ? 'İptal edildi' : file.state === 'queued' ? 'Telefonun bağlanmasını bekliyor' : 'Aktarılıyor'}</small><progress max={Math.max(1, file.size)} value={file.state === 'completed' ? Math.max(1, file.size) : file.transferred} aria-label={`${file.fileName} aktarım ilerlemesi`}/></div>{file.state === 'completed' ? <><Check size={18}/>{file.direction === 'receive' && <button type="button" className="eon2-button eon2-button--outline" onClick={() => void invoke('eon2:files:save-as', { id: file.id }).catch(error => setError(errorText(error)))}>Farklı kaydet</button>}</> : file.state !== 'cancelled' && <button aria-label="Aktarımı iptal et" className="eon2-button eon2-button--quiet" onClick={async () => { try { await invoke('eon2:files:cancel', { id: file.id }); await reload() } catch (error) { setError(errorText(error)) } }}><X size={16}/></button>}</article>)}</div>
    <p className="eon2-quiet-label">LocalSend dosya metadatası · Eon kimlik doğrulamalı aktarım · 256 KB parçalar · Dosya başına 8 GB</p></>
}
